const RESOURCE_TYPES = Object.freeze([
  "PATIENT",
  "COVERAGE",
  "APPOINTMENT",
  "ENCOUNTER",
  "ORDER",
  "PROVIDER",
  "CLINICAL_EVIDENCE",
  "CHARGE",
  "CLAIM"
]);

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, compactObject(item)])
  );
}

function fhirReference(value) {
  return String(value?.reference || "").trim() || null;
}

function firstCoding(value) {
  const coding = value?.coding?.[0];
  if (!coding) return null;
  return compactObject({
    system: coding.system || null,
    code: coding.code || null,
    display: coding.display || value?.text || null
  });
}

function humanName(resource) {
  const name = resource?.name?.[0];
  if (!name) return null;
  const parts = [
    ...(name.prefix || []),
    ...(name.given || []),
    name.family,
    ...(name.suffix || [])
  ].filter(Boolean);
  return parts.join(" ").trim() || name.text || null;
}

function identifierMap(resource) {
  const result = {};
  for (const item of resource?.identifier || []) {
    const key =
      item?.type?.coding?.[0]?.code ||
      item?.system ||
      "identifier_" + (Object.keys(result).length + 1);
    if (item?.value) result[key] = item.value;
  }
  return result;
}

function fhirRecord(resource) {
  const type = String(resource?.resourceType || "");
  const externalId = String(resource?.id || "").trim();
  if (!externalId) {
    const error = new Error("FHIR " + (type || "resource") + " is missing id");
    error.code = "INTEGRATION_RESOURCE_ID_REQUIRED";
    throw error;
  }

  const base = { externalId, sourceType: type };

  if (type === "Patient") {
    return {
      ...base,
      resourceType: "PATIENT",
      data: compactObject({
        name: humanName(resource),
        birthDate: resource.birthDate || null,
        gender: resource.gender || null,
        active: resource.active ?? null,
        identifiers: identifierMap(resource),
        telecom: resource.telecom || [],
        address: resource.address || []
      })
    };
  }

  if (type === "Coverage") {
    return {
      ...base,
      resourceType: "COVERAGE",
      data: compactObject({
        status: resource.status || null,
        subscriberId: resource.subscriberId || null,
        beneficiaryRef: fhirReference(resource.beneficiary),
        subscriberRef: fhirReference(resource.subscriber),
        payorRefs: (resource.payor || []).map(fhirReference).filter(Boolean),
        period: resource.period || null,
        class: resource.class || [],
        type: firstCoding(resource.type)
      })
    };
  }

  if (type === "Appointment") {
    return {
      ...base,
      resourceType: "APPOINTMENT",
      data: compactObject({
        status: resource.status || null,
        serviceType: (resource.serviceType || []).map(firstCoding).filter(Boolean),
        start: resource.start || null,
        end: resource.end || null,
        participants: (resource.participant || []).map((item) => ({
          actorRef: fhirReference(item.actor),
          status: item.status || null
        }))
      })
    };
  }

  if (type === "Encounter") {
    return {
      ...base,
      resourceType: "ENCOUNTER",
      data: compactObject({
        status: resource.status || null,
        class: resource.class || null,
        subjectRef: fhirReference(resource.subject),
        appointmentRefs: (resource.appointment || []).map(fhirReference).filter(Boolean),
        period: resource.period || null,
        serviceProviderRef: fhirReference(resource.serviceProvider),
        type: (resource.type || []).map(firstCoding).filter(Boolean)
      })
    };
  }

  if (type === "ServiceRequest") {
    return {
      ...base,
      resourceType: "ORDER",
      data: compactObject({
        status: resource.status || null,
        intent: resource.intent || null,
        subjectRef: fhirReference(resource.subject),
        encounterRef: fhirReference(resource.encounter),
        requesterRef: fhirReference(resource.requester),
        authoredOn: resource.authoredOn || null,
        code: firstCoding(resource.code),
        reasonCodes: (resource.reasonCode || []).map(firstCoding).filter(Boolean)
      })
    };
  }

  if (["Practitioner", "Organization", "PractitionerRole"].includes(type)) {
    return {
      ...base,
      resourceType: "PROVIDER",
      data: compactObject({
        providerType: type,
        name: type === "Practitioner" ? humanName(resource) : resource.name || null,
        identifiers: identifierMap(resource),
        practitionerRef: fhirReference(resource.practitioner),
        organizationRef: fhirReference(resource.organization),
        specialty: (resource.specialty || []).map(firstCoding).filter(Boolean)
      })
    };
  }

  if (["DocumentReference", "DiagnosticReport", "Observation", "Procedure", "Condition"].includes(type)) {
    return {
      ...base,
      resourceType: "CLINICAL_EVIDENCE",
      data: compactObject({
        evidenceType: type,
        status: resource.status || null,
        subjectRef: fhirReference(resource.subject),
        encounterRef: fhirReference(resource.encounter),
        code: firstCoding(resource.code || resource.type),
        effectiveDateTime: resource.effectiveDateTime || resource.performedDateTime || null,
        issued: resource.issued || null,
        category: (resource.category || []).map(firstCoding).filter(Boolean),
        presentedForm: resource.presentedForm || [],
        content: resource.content || []
      })
    };
  }

  if (type === "ChargeItem") {
    return {
      ...base,
      resourceType: "CHARGE",
      data: compactObject({
        status: resource.status || null,
        subjectRef: fhirReference(resource.subject),
        contextRef: fhirReference(resource.context),
        service: firstCoding(resource.code),
        quantity: resource.quantity?.value ?? null,
        unitPrice: resource.priceOverride?.value ?? null,
        currency: resource.priceOverride?.currency || null,
        occurrenceDateTime: resource.occurrenceDateTime || null
      })
    };
  }

  if (type === "Claim") {
    return {
      ...base,
      resourceType: "CLAIM",
      data: compactObject({
        status: resource.status || null,
        use: resource.use || null,
        patientRef: fhirReference(resource.patient),
        providerRef: fhirReference(resource.provider),
        insurerRef: fhirReference(resource.insurer),
        created: resource.created || null,
        total: resource.total || null,
        diagnosis: (resource.diagnosis || []).map((item) => ({
          sequence: item.sequence,
          diagnosis: firstCoding(item.diagnosisCodeableConcept)
        })),
        items: (resource.item || []).map((item) => ({
          sequence: item.sequence,
          productOrService: firstCoding(item.productOrService),
          servicedDate: item.servicedDate || null,
          quantity: item.quantity?.value ?? null,
          unitPrice: item.unitPrice?.value ?? null,
          net: item.net || null
        }))
      })
    };
  }

  return null;
}

function normalizeFhir(payload) {
  const resources =
    payload?.resourceType === "Bundle"
      ? (payload.entry || []).map((entry) => entry?.resource).filter(Boolean)
      : [payload];

  const records = resources.map(fhirRecord).filter(Boolean);
  if (!records.length) {
    const error = new Error("FHIR payload did not contain supported resources");
    error.code = "INTEGRATION_UNSUPPORTED_RESOURCE";
    throw error;
  }
  return records;
}

function splitHl7(line, delimiter = "|") {
  return String(line || "").split(delimiter);
}

function hl7Date(value) {
  const raw = String(value || "").trim();
  if (!/^\d{8}/.test(raw)) return null;
  return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8);
}

function normalizeHl7(payload) {
  const text = String(payload || "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const segments = text.split("\r").map((line) => line.trim()).filter(Boolean);
  const byName = new Map();
  for (const line of segments) {
    const fields = splitHl7(line);
    const key = fields[0];
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(fields);
  }

  const msh = byName.get("MSH")?.[0];
  if (!msh) {
    const error = new Error("HL7 v2 message requires MSH segment");
    error.code = "INVALID_HL7_MESSAGE";
    throw error;
  }

  const messageControlId = msh[9] || null;
  const event = String(msh[8] || "");
  const records = [];

  const pid = byName.get("PID")?.[0];
  if (pid) {
    const patientId = pid[3]?.split("^")?.[0] || pid[2]?.split("^")?.[0] || messageControlId;
    const name = pid[5]?.split("^") || [];
    records.push({
      resourceType: "PATIENT",
      externalId: patientId,
      sourceType: "HL7_PID",
      data: compactObject({
        name: [name[1], name[2], name[0]].filter(Boolean).join(" ").trim() || null,
        birthDate: hl7Date(pid[7]),
        gender: pid[8] || null,
        address: pid[11] || null,
        identifiers: { mrn: patientId }
      })
    });
  }

  const sch = byName.get("SCH")?.[0];
  if (sch) {
    records.push({
      resourceType: "APPOINTMENT",
      externalId: sch[1]?.split("^")?.[0] || messageControlId,
      sourceType: "HL7_SCH",
      data: compactObject({
        event,
        placerAppointmentId: sch[1] || null,
        fillerAppointmentId: sch[2] || null,
        start: sch[11] || null,
        reason: sch[7] || null
      })
    });
  }

  const pv1 = byName.get("PV1")?.[0];
  if (pv1) {
    records.push({
      resourceType: "ENCOUNTER",
      externalId: pv1[19]?.split("^")?.[0] || messageControlId,
      sourceType: "HL7_PV1",
      data: compactObject({
        event,
        patientClass: pv1[2] || null,
        location: pv1[3] || null,
        attendingProvider: pv1[7] || null,
        visitNumber: pv1[19] || null,
        admitDateTime: pv1[44] || null,
        dischargeDateTime: pv1[45] || null
      })
    });
  }

  for (const [index, obr] of (byName.get("OBR") || []).entries()) {
    records.push({
      resourceType: "ORDER",
      externalId: obr[3]?.split("^")?.[0] || obr[2]?.split("^")?.[0] || messageControlId + "-obr-" + (index + 1),
      sourceType: "HL7_OBR",
      data: compactObject({
        event,
        placerOrderNumber: obr[2] || null,
        fillerOrderNumber: obr[3] || null,
        service: obr[4] || null,
        requestedDateTime: obr[6] || null,
        orderingProvider: obr[16] || null
      })
    });
  }

  for (const [index, ft1] of (byName.get("FT1") || []).entries()) {
    records.push({
      resourceType: "CHARGE",
      externalId: ft1[2] || messageControlId + "-ft1-" + (index + 1),
      sourceType: "HL7_FT1",
      data: compactObject({
        event,
        transactionDate: hl7Date(ft1[4]),
        transactionCode: ft1[7] || null,
        amount: ft1[11] || null,
        quantity: ft1[10] || null,
        provider: ft1[20] || null
      })
    });
  }

  if (!records.length) {
    const error = new Error("HL7 v2 message did not contain supported segments");
    error.code = "INTEGRATION_UNSUPPORTED_RESOURCE";
    throw error;
  }
  return records;
}

function normalizeCanonical(payload) {
  const raw = Array.isArray(payload?.records)
    ? payload.records
    : Array.isArray(payload)
    ? payload
    : [payload];

  return raw.map((record) => {
    const resourceType = String(record?.resourceType || "").toUpperCase();
    const externalId = String(record?.externalId || "").trim();
    if (!RESOURCE_TYPES.includes(resourceType)) {
      const error = new Error("Unsupported canonical resource type: " + (resourceType || "missing"));
      error.code = "INTEGRATION_UNSUPPORTED_RESOURCE";
      throw error;
    }
    if (!externalId) {
      const error = new Error("Canonical record externalId is required");
      error.code = "INTEGRATION_RESOURCE_ID_REQUIRED";
      throw error;
    }
    if (!record?.data || typeof record.data !== "object" || Array.isArray(record.data)) {
      const error = new Error("Canonical record data must be an object");
      error.code = "INVALID_INTEGRATION_PAYLOAD";
      throw error;
    }
    return {
      resourceType,
      externalId,
      sourceType: record.sourceType || "CANONICAL",
      data: compactObject(record.data)
    };
  });
}

const ADAPTERS = Object.freeze({
  FHIR_R4: {
    id: "FHIR_R4",
    label: "FHIR R4",
    transports: ["REST", "WEBHOOK"],
    normalize: normalizeFhir
  },
  HL7_V2: {
    id: "HL7_V2",
    label: "HL7 v2",
    transports: ["MLLP", "FILE", "SFTP"],
    normalize: normalizeHl7
  },
  CANONICAL_JSON: {
    id: "CANONICAL_JSON",
    label: "PRISM Canonical JSON",
    transports: ["REST", "WEBHOOK", "FILE", "SFTP"],
    normalize: normalizeCanonical
  }
});

export function integrationAdapterCatalog() {
  return Object.values(ADAPTERS).map(({ id, label, transports }) => ({
    id,
    label,
    transports,
    resourceTypes: [...RESOURCE_TYPES]
  }));
}

export function normalizeIntegrationPayload(format, payload) {
  const adapter = ADAPTERS[String(format || "").toUpperCase()];
  if (!adapter) {
    const error = new Error("Unsupported integration format: " + (format || "missing"));
    error.code = "INTEGRATION_FORMAT_UNSUPPORTED";
    throw error;
  }
  return adapter.normalize(payload);
}

export function supportedIntegrationResourceTypes() {
  return [...RESOURCE_TYPES];
}
