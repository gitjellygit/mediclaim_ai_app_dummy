function stringValue(value) {
  const text = String(value || "").trim();
  return text || null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function referenceId(reference, type) {
  const raw = String(reference || "");
  const prefix = type + "/";
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

function recordData(record) {
  return record?.data && typeof record.data === "object" ? record.data : {};
}

function encounterTime(record) {
  const data = recordData(record);
  const value = data.period?.end || data.period?.start || null;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function chargeAmount(data) {
  const net = positiveNumber(data.netPrice);
  if (net) return net;
  const unit = positiveNumber(data.unitPrice);
  const quantity = positiveNumber(data.quantity) || 1;
  return unit ? unit * quantity : null;
}

function preferredBillingCode(data) {
  const procedure = (data.procedureCodes || []).find((item) => stringValue(item?.code));
  const service = data.service;
  return stringValue(procedure?.code || service?.code);
}

function displayPayer(coverage) {
  const data = recordData(coverage);
  return stringValue(
    (data.payors || []).find((item) => stringValue(item?.display))?.display ||
    data.type?.display
  );
}

function patientMrn(patient) {
  const identifiers = recordData(patient).identifiers || {};
  for (const [key, value] of Object.entries(identifiers)) {
    if (/mrn|medical.record|mr/i.test(key) && stringValue(value)) return String(value);
  }
  return Object.values(identifiers).map(stringValue).find(Boolean) || null;
}

function diagnosisCodes(records, patientId, encounterId) {
  const patientRef = "Patient/" + patientId;
  const encounterRef = encounterId ? "Encounter/" + encounterId : null;
  return records
    .filter((record) => record.resourceType === "CLINICAL_EVIDENCE")
    .filter((record) => {
      const data = recordData(record);
      if (data.evidenceType !== "Condition") return false;
      if (data.subjectRef && data.subjectRef !== patientRef) return false;
      if (encounterRef && data.encounterRef && data.encounterRef !== encounterRef) return false;
      return true;
    })
    .map((record) => recordData(record).code)
    .filter((code) => stringValue(code?.code) && /icd/i.test(String(code?.system || "")))
    .map((code) => String(code.code))
    .filter((code, index, all) => all.indexOf(code) === index)
    .slice(0, 12);
}

export function buildIntegrationClaimDraft(records, { patientId, encounterId = null } = {}) {
  const id = stringValue(patientId);
  if (!id) {
    return {
      ready: false,
      missing: ["patientId"],
      message: "Choose or sync a patient before creating a claim draft."
    };
  }

  const patient = records.find(
    (record) => record.resourceType === "PATIENT" && record.externalId === id
  );
  const patientRef = "Patient/" + id;

  const encounters = records
    .filter((record) => record.resourceType === "ENCOUNTER")
    .filter((record) => recordData(record).subjectRef === patientRef)
    .sort((a, b) => encounterTime(b) - encounterTime(a));

  let encounter = encounterId
    ? encounters.find((item) => item.externalId === encounterId)
    : null;

  if (!encounter) {
    encounter = encounters.find((item) =>
      records.some(
        (record) =>
          record.resourceType === "CHARGE" &&
          recordData(record).contextRef === "Encounter/" + item.externalId &&
          chargeAmount(recordData(record))
      )
    ) || encounters[0] || null;
  }

  const encounterRef = encounter ? "Encounter/" + encounter.externalId : null;
  const charges = records
    .filter((record) => record.resourceType === "CHARGE")
    .filter((record) => !encounterRef || recordData(record).contextRef === encounterRef)
    .filter((record) => recordData(record).subjectRef === patientRef || !recordData(record).subjectRef);

  const coverage = records
    .filter((record) => record.resourceType === "COVERAGE")
    .filter((record) => {
      const data = recordData(record);
      return data.beneficiaryRef === patientRef || data.subscriberRef === patientRef;
    })
    .sort((a, b) => {
      const aActive = recordData(a).status === "active" ? 1 : 0;
      const bActive = recordData(b).status === "active" ? 1 : 0;
      return bActive - aActive;
    })[0] || null;

  const serviceLines = charges
    .map((record) => {
      const data = recordData(record);
      const amount = chargeAmount(data);
      const code = preferredBillingCode(data);
      if (!amount || !code) return null;
      return {
        integrationRecordId: record.id,
        externalId: record.externalId,
        cptHcpcsCode: code,
        modifiers: (data.modifiers || []).map((item) => item?.code).filter(Boolean),
        units: positiveNumber(data.quantity) || 1,
        charge: amount,
        serviceDateFrom: data.occurrenceDateTime || recordData(encounter).period?.start || null,
        serviceDateTo: data.occurrenceDateTime || recordData(encounter).period?.end || null,
        revenueCode: stringValue(data.revenueCodes?.[0]?.code),
        source: "INTEGRATION",
        verified: false
      };
    })
    .filter(Boolean);

  const totalBilledAmount = serviceLines.reduce((sum, line) => sum + Number(line.charge || 0), 0);
  const patientData = recordData(patient);
  const coverageData = recordData(coverage);
  const encounterData = recordData(encounter);
  const icd10Codes = diagnosisCodes(records, id, encounter?.externalId || null);

  const claimData = {
    patientName: stringValue(patientData.name),
    patientDob: patientData.birthDate || null,
    patientGender: patientData.gender || null,
    medicalRecordNumber: patientMrn(patient),
    payerName: displayPayer(coverage),
    subscriberId: stringValue(coverageData.subscriberId),
    memberId: stringValue(coverageData.subscriberId),
    policyStartDate: coverageData.period?.start || null,
    policyEndDate: coverageData.period?.end || null,
    dateOfService: encounterData.period?.start || serviceLines[0]?.serviceDateFrom || null,
    diagnosisText: icd10Codes.length ? icd10Codes.join(", ") : null,
    icd10Codes,
    amount: totalBilledAmount || null,
    totalBilledAmount: totalBilledAmount || null,
    claimType: "PROVIDER_BILLED"
  };

  const blockingMissing = [];
  const completionWarnings = [];
  if (!claimData.patientName) blockingMissing.push("patient name");
  if (!encounter) blockingMissing.push("encounter");
  if (!serviceLines.length) blockingMissing.push("billable charges");
  if (!claimData.amount) blockingMissing.push("positive billed amount");
  if (!claimData.payerName) completionWarnings.push("payer / coverage");

  const recordIds = [
    patient?.id,
    coverage?.id,
    encounter?.id,
    ...serviceLines.map((line) => line.integrationRecordId),
    ...records
      .filter((record) => record.resourceType === "CLINICAL_EVIDENCE")
      .filter((record) => {
        const data = recordData(record);
        return data.subjectRef === patientRef &&
          (!encounterRef || !data.encounterRef || data.encounterRef === encounterRef);
      })
      .map((record) => record.id)
  ].filter(Boolean);

  const existingClaimId =
    records
      .filter((record) => recordIds.includes(record.id))
      .map((record) => record.claimId)
      .find(Boolean) || null;

  return {
    ready: blockingMissing.length === 0,
    missing: blockingMissing,
    warnings: completionWarnings,
    message: blockingMissing.length
      ? "Claim draft needs " + blockingMissing.join(", ") + "."
      : completionWarnings.length
        ? "Draft claim can be created. Complete " + completionWarnings.join(", ") + " before submission."
        : "Imported EHR data is ready to create a draft claim.",
    patientId: id,
    encounterId: encounter?.externalId || null,
    externalClaimId: encounter
      ? "ehr:" + id + ":encounter:" + encounter.externalId
      : "ehr:" + id,
    existingClaimId,
    claimData,
    serviceLines,
    recordIds: [...new Set(recordIds)],
    summary: {
      patientName: claimData.patientName,
      payerName: claimData.payerName,
      encounterDate: claimData.dateOfService,
      encounterId: encounter?.externalId || null,
      chargeCount: serviceLines.length,
      totalBilledAmount: claimData.totalBilledAmount,
      diagnosisCount: icd10Codes.length
    }
  };
}
