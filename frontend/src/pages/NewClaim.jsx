import React from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Button,
  Stack,
  MenuItem,
  Divider
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../api/claims.js";
import { useToast } from "../context/ToastContext.jsx";
import { formatUSD } from "../utils/currency.js";
import ServiceLinesEditor, { serviceLineToPayload } from "../components/ServiceLinesEditor.jsx";

const steps = [
  "Patient & Hospital",
  "Admission & Diagnosis",
  "Policy & Insurance",
  "Financials",
  "Review"
];

const ICD_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

export default function NewClaim() {
  const { showDialog } = useToast();
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = React.useState(0);
  const [errors, setErrors] = React.useState({});
  const [submitting, setSubmitting] = React.useState(false);

  const [form, setForm] = React.useState({
    // Patient
    patientName: "",
    patientAge: "",
    patientGender: "",
    medicalRecordNumber: "",

    // Claim form / hospital / admission
    claimForm: "",
    hospitalName: "",
    billingProviderNpi: "",
    renderingProviderNpi: "",
    referringProviderNpi: "",
    providerTin: "",
    providerTaxonomyCode: "",
    diagnosisText: "",
    icd10Codes: "",
    inpatientProcedureCodes: "",

    // Policy
    payerName: "",
    policyNo: "",
    memberId: "",
    planAdministratorName: "",
    payerReferenceNo: "",
    groupNumber: "",
    subscriberId: "",
    subscriberName: "",
    subscriberRelationship: "",
    coordinationOfBenefits: "",
    payerEdiId: "",

    // Financials
    claimType: "MEMBER_REIMBURSEMENT",
    totalBilledAmount: "",
    amount: "",
    coverageLimit: "",
    remainingCoverageLimit: "",
    typeOfBill: "",
    drgCode: "",
    claimFrequencyCode: "ORIGINAL",
    timelyFilingDeadline: "",
    serviceLines: []
  });

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
  }

  function validateStep(step) {
    const e = {};

    // REVIEW STEP SHOULD NEVER BLOCK
    if (step === 4) return true;

    if (step === 0) {
      if (!form.patientName) e.patientName = "Patient name is required";
      if (!form.claimForm) e.claimForm = "Select Professional (837P) or Institutional (837I)";
      if (!form.billingProviderNpi) e.billingProviderNpi = "Billing provider NPI is required";
      if (form.claimForm === "PROFESSIONAL" && !form.renderingProviderNpi) {
        e.renderingProviderNpi = "Rendering provider NPI is required for 837P";
      }
    }

    if (step === 1 && form.icd10Codes) {
      const invalid = form.icd10Codes
        .split(",")
        .map((c) => c.trim())
        .filter((c) => !ICD_REGEX.test(c));

      if (invalid.length) {
        e.icd10Codes = `Invalid ICD-10 codes: ${invalid.join(", ")}`;
      }
    }

    if (step === 2) {
      if (!form.payerName) e.payerName = "Insurance company is required";
    }

    if (step === 3) {
      const claimed = Number(form.amount);
      const billed = Number(form.totalBilledAmount);

      if (!claimed || claimed <= 0) {
        e.amount = "Claimed amount must be greater than 0";
      }

      if (billed && claimed > billed) {
        e.amount = "Claimed amount cannot exceed billed amount";
      }

      const activeLines = form.serviceLines.filter((line) => line.cptHcpcsCode?.trim());
      if (activeLines.length === 0) {
        e.serviceLines = "At least one service line is required";
      } else if (form.claimForm === "PROFESSIONAL" && activeLines.some((line) => !line.placeOfService?.trim())) {
        e.serviceLines = "Place of Service is required on every 837P service line";
      } else if (form.claimForm === "INSTITUTIONAL" && activeLines.some((line) => !line.revenueCode?.trim())) {
        e.serviceLines = "Revenue Code is required on every 837I service line";
      }

      if (form.claimForm === "INSTITUTIONAL" && !form.typeOfBill?.trim()) {
        e.typeOfBill = "Type of Bill is required for 837I";
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (!validateStep(activeStep)) return;
    setActiveStep((s) => s + 1);
  }

  function back() {
    setActiveStep((s) => s - 1);
  }

  const submit = async () => {
    // HARD STOP validations (final gate)
    if (!form.patientName || !form.payerName || !form.amount) {
      showDialog(
        "Patient name, insurance company, and claimed amount are required before a claim can be created.",
        { title: "Required information missing", severity: "warning" }
      );
      return;
    }
  
    const amount = Number(form.amount);
    const billed = form.totalBilledAmount
      ? Number(form.totalBilledAmount)
      : null;
  
    if (Number.isNaN(amount)) {
      showDialog(
        "Claimed amount must be a valid number greater than zero.",
        { title: "Invalid claimed amount", severity: "warning" }
      );
      return;
    }
  
    if (billed !== null && Number.isNaN(billed)) {
      showDialog(
        "Billed amount must be a valid number when provided.",
        { title: "Invalid billed amount", severity: "warning" }
      );
      return;
    }
  
    try {
      setSubmitting(true);
  
      const payload = {
        patientName: form.patientName,
        payerName: form.payerName,
        policyNo: form.policyNo || null,
        memberId: form.memberId || null,
        medicalRecordNumber: form.medicalRecordNumber || null,
        planAdministratorName: form.planAdministratorName || null,
        payerReferenceNo: form.payerReferenceNo || null,
        groupNumber: form.groupNumber || null,
        subscriberId: form.subscriberId || null,
        subscriberName: form.subscriberName || null,
        subscriberRelationship: form.subscriberRelationship || null,
        coordinationOfBenefits: form.coordinationOfBenefits || null,
        payerEdiId: form.payerEdiId || null,
        coverageLimit: form.coverageLimit ? Number(form.coverageLimit) : null,
        remainingCoverageLimit: form.remainingCoverageLimit
          ? Number(form.remainingCoverageLimit)
          : null,
        claimForm: form.claimForm,
        hospitalName: form.hospitalName || null,
        billingProviderNpi: form.billingProviderNpi || null,
        renderingProviderNpi: form.renderingProviderNpi || null,
        referringProviderNpi: form.referringProviderNpi || null,
        providerTin: form.providerTin || null,
        providerTaxonomyCode: form.providerTaxonomyCode || null,
        diagnosisText: form.diagnosisText || null,
        claimType: form.claimType,
        typeOfBill: form.typeOfBill || null,
        drgCode: form.drgCode || null,
        claimFrequencyCode: form.claimFrequencyCode || "ORIGINAL",
        timelyFilingDeadline: form.timelyFilingDeadline || null,
  
        amount,
        totalBilledAmount: billed,
  
        icd10Codes: form.icd10Codes
          ? form.icd10Codes.split(",").map(c => c.trim())
          : [],
        inpatientProcedureCodes: form.inpatientProcedureCodes
          ? form.inpatientProcedureCodes.split(",").map(c => c.trim()).filter(Boolean)
          : [],
        serviceLines: form.serviceLines
          .filter((line) => line.cptHcpcsCode?.trim())
          .map(serviceLineToPayload)
      };
  
      await ClaimsApi.create(payload);
      navigate("/claims");
    } catch (e) {
      showDialog(
        e.message || "The claim could not be created. Please review the information and try again.",
        { title: "Claim creation failed", severity: "error" }
      );
    } finally {
      setSubmitting(false);
    }
  };
  
  return (
    <Box sx={{ maxWidth: 900, mx: "auto", p: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            New Medical Claim
          </Typography>

          <Stepper activeStep={activeStep} sx={{ my: 3 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {/* STEP 1 */}
          {activeStep === 0 && (
            <Stack spacing={2}>
              <TextField
                label="Claim Form"
                select
                value={form.claimForm}
                onChange={(e) => update("claimForm", e.target.value)}
                error={!!errors.claimForm}
                helperText={errors.claimForm || "837P = Professional | 837I = Institutional"}
              >
                <MenuItem value="PROFESSIONAL">Professional (837P)</MenuItem>
                <MenuItem value="INSTITUTIONAL">Institutional (837I)</MenuItem>
              </TextField>
              <TextField
                label="Patient Name"
                value={form.patientName}
                onChange={(e) => update("patientName", e.target.value)}
                error={!!errors.patientName}
                helperText={errors.patientName}
              />
              <TextField
                label="Hospital Name"
                value={form.hospitalName}
                onChange={(e) => update("hospitalName", e.target.value)}
              />
              <TextField
                label="Billing Provider NPI"
                value={form.billingProviderNpi}
                onChange={(e) => update("billingProviderNpi", e.target.value)}
                error={!!errors.billingProviderNpi}
                helperText={errors.billingProviderNpi}
              />
              {form.claimForm === "PROFESSIONAL" && (
                <>
                  <TextField
                    label="Rendering Provider NPI"
                    value={form.renderingProviderNpi}
                    onChange={(e) => update("renderingProviderNpi", e.target.value)}
                    error={!!errors.renderingProviderNpi}
                    helperText={errors.renderingProviderNpi}
                  />
                  <TextField
                    label="Referring Provider NPI"
                    value={form.referringProviderNpi}
                    onChange={(e) => update("referringProviderNpi", e.target.value)}
                  />
                </>
              )}
              <TextField
                label="Provider TIN"
                value={form.providerTin}
                onChange={(e) => update("providerTin", e.target.value)}
              />
              <TextField
                label="Provider Taxonomy Code"
                value={form.providerTaxonomyCode}
                onChange={(e) => update("providerTaxonomyCode", e.target.value)}
              />
            </Stack>
          )}

          {/* STEP 2 */}
          {activeStep === 1 && (
            <Stack spacing={2}>
              <TextField
                label="Diagnosis"
                value={form.diagnosisText}
                onChange={(e) => update("diagnosisText", e.target.value)}
              />
              <TextField
                label="ICD-10 Codes (comma separated)"
                value={form.icd10Codes}
                onChange={(e) => update("icd10Codes", e.target.value)}
                error={!!errors.icd10Codes}
                helperText={errors.icd10Codes}
              />
              <TextField
                label="ICD-10-PCS Codes (inpatient, comma separated)"
                value={form.inpatientProcedureCodes}
                onChange={(e) => update("inpatientProcedureCodes", e.target.value)}
              />
            </Stack>
          )}

          {/* STEP 3 */}
          {activeStep === 2 && (
            <Stack spacing={2}>
              <TextField
                label="Medical Record Number (MRN, optional)"
                value={form.medicalRecordNumber}
                onChange={(e) => update("medicalRecordNumber", e.target.value)}
              />
              <TextField
                label="Insurance Company"
                value={form.payerName}
                onChange={(e) => update("payerName", e.target.value)}
                error={!!errors.payerName}
                helperText={errors.payerName}
              />
              <TextField
                label="Policy Number (optional)"
                value={form.policyNo}
                onChange={(e) => update("policyNo", e.target.value)}
              />
              <TextField
                label="Member ID (optional)"
                value={form.memberId}
                onChange={(e) => update("memberId", e.target.value)}
              />
              <TextField
                label="Plan Administrator (optional)"
                value={form.planAdministratorName}
                onChange={(e) => update("planAdministratorName", e.target.value)}
              />
              <TextField
                label="Payer Reference Number (optional)"
                value={form.payerReferenceNo}
                onChange={(e) => update("payerReferenceNo", e.target.value)}
              />
              <TextField
                label="Group Number (optional)"
                value={form.groupNumber}
                onChange={(e) => update("groupNumber", e.target.value)}
              />
              <TextField
                label="Subscriber ID (optional)"
                value={form.subscriberId}
                onChange={(e) => update("subscriberId", e.target.value)}
              />
              <TextField
                label="Subscriber Name (optional)"
                value={form.subscriberName}
                onChange={(e) => update("subscriberName", e.target.value)}
              />
              <TextField
                label="Subscriber Relationship"
                select
                value={form.subscriberRelationship}
                onChange={(e) => update("subscriberRelationship", e.target.value)}
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="SELF">Self</MenuItem>
                <MenuItem value="SPOUSE">Spouse</MenuItem>
                <MenuItem value="CHILD">Child</MenuItem>
                <MenuItem value="OTHER">Other</MenuItem>
              </TextField>
              <TextField
                label="Coordination of Benefits"
                select
                value={form.coordinationOfBenefits}
                onChange={(e) => update("coordinationOfBenefits", e.target.value)}
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="PRIMARY">Primary</MenuItem>
                <MenuItem value="SECONDARY">Secondary</MenuItem>
                <MenuItem value="TERTIARY">Tertiary</MenuItem>
              </TextField>
              <TextField
                label="Payer EDI ID (optional)"
                value={form.payerEdiId}
                onChange={(e) => update("payerEdiId", e.target.value)}
              />
            </Stack>
          )}

          {/* STEP 4 */}
          {activeStep === 3 && (
            <Stack spacing={2}>
              <TextField
                label="Claim Type"
                select
                value={form.claimType}
                onChange={(e) => update("claimType", e.target.value)}
              >
                <MenuItem value="MEMBER_REIMBURSEMENT">Member Reimbursement</MenuItem>
                <MenuItem value="PROVIDER_BILLED">Provider Billed</MenuItem>
              </TextField>

              <TextField
                label="Total Billed Amount (USD)"
                type="number"
                value={form.totalBilledAmount}
                onChange={(e) =>
                  update("totalBilledAmount", e.target.value)
                }
              />

              <TextField
                label="Coverage Limit (USD, optional)"
                type="number"
                value={form.coverageLimit}
                onChange={(e) => update("coverageLimit", e.target.value)}
              />

              <TextField
                label="Remaining Coverage Limit (USD, optional)"
                type="number"
                value={form.remainingCoverageLimit}
                onChange={(e) => update("remainingCoverageLimit", e.target.value)}
              />

              <TextField
                label="Total Claimed Amount (USD)"
                type="number"
                value={form.amount}
                onChange={(e) => update("amount", e.target.value)}
                error={!!errors.amount}
                helperText={errors.amount}
              />

              <TextField
                label="Claim Frequency"
                select
                value={form.claimFrequencyCode}
                onChange={(e) => update("claimFrequencyCode", e.target.value)}
              >
                <MenuItem value="ORIGINAL">Original</MenuItem>
                <MenuItem value="CORRECTED">Corrected</MenuItem>
                <MenuItem value="VOID">Void</MenuItem>
              </TextField>

              <TextField
                label="Timely Filing Deadline"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={form.timelyFilingDeadline}
                onChange={(e) => update("timelyFilingDeadline", e.target.value)}
              />

              {form.claimForm === "INSTITUTIONAL" && (
                <>
                  <TextField
                    label="Type of Bill"
                    value={form.typeOfBill}
                    onChange={(e) => update("typeOfBill", e.target.value)}
                    error={!!errors.typeOfBill}
                    helperText={errors.typeOfBill}
                  />

                  <TextField
                    label="DRG"
                    value={form.drgCode}
                    onChange={(e) => update("drgCode", e.target.value)}
                  />
                </>
              )}

              <Divider />
              <Typography variant="h6">Service Lines</Typography>
              <ServiceLinesEditor
                lines={form.serviceLines}
                onChange={(serviceLines) => update("serviceLines", serviceLines)}
              />
              {errors.serviceLines && (
                <Typography color="error" variant="body2">{errors.serviceLines}</Typography>
              )}
            </Stack>
          )}

          {/* STEP 5 – REVIEW (NO RAW JSON) */}
          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h6">Review Summary</Typography>

              <Divider />
              <Typography><b>Claim Form:</b> {form.claimForm === "PROFESSIONAL" ? "Professional (837P)" : "Institutional (837I)"}</Typography>
              <Typography><b>Patient:</b> {form.patientName}</Typography>
              <Typography><b>Hospital:</b> {form.hospitalName || "—"}</Typography>
              <Typography><b>Billing NPI:</b> {form.billingProviderNpi || "—"}</Typography>
              <Typography><b>Rendering NPI:</b> {form.renderingProviderNpi || "—"}</Typography>

              <Divider />
              <Typography><b>Diagnosis:</b> {form.diagnosisText || "—"}</Typography>
              <Typography><b>ICD-10-CM:</b> {form.icd10Codes || "—"}</Typography>
              <Typography><b>ICD-10-PCS:</b> {form.inpatientProcedureCodes || "—"}</Typography>

              <Divider />
              <Typography><b>Insurance:</b> {form.payerName}</Typography>
              <Typography><b>Policy No:</b> {form.policyNo || "—"}</Typography>
              <Typography><b>Member ID:</b> {form.memberId || "—"}</Typography>
              <Typography><b>MRN:</b> {form.medicalRecordNumber || "—"}</Typography>
              <Typography><b>Plan Administrator:</b> {form.planAdministratorName || "—"}</Typography>
              <Typography><b>Payer Reference:</b> {form.payerReferenceNo || "—"}</Typography>
              <Typography><b>Group Number:</b> {form.groupNumber || "—"}</Typography>
              <Typography><b>Subscriber:</b> {form.subscriberName || "—"} ({form.subscriberRelationship || "—"})</Typography>
              <Typography><b>COB:</b> {form.coordinationOfBenefits || "—"}</Typography>
              <Typography><b>Payer EDI ID:</b> {form.payerEdiId || "—"}</Typography>

              <Divider />
              <Typography>
                <b>Billed:</b> {formatUSD(form.totalBilledAmount)} &nbsp; | &nbsp;
                <b> Claimed:</b> {formatUSD(form.amount)} &nbsp; | &nbsp;
                <b> Coverage:</b> {formatUSD(form.coverageLimit)}
              </Typography>
              <Typography><b>Frequency:</b> {form.claimFrequencyCode}</Typography>
              <Typography><b>Type of Bill:</b> {form.typeOfBill || "—"} | <b>DRG:</b> {form.drgCode || "—"}</Typography>
              <Typography><b>Service Lines:</b> {form.serviceLines.filter((line) => line.cptHcpcsCode?.trim()).length}</Typography>
            </Stack>
          )}

          {/* ACTIONS */}
          <Stack direction="row" spacing={2} sx={{ mt: 4 }}>
            <Button disabled={activeStep === 0} onClick={back}>
              Back
            </Button>

            {activeStep < 4 ? (
              <Button variant="contained" onClick={next}>
                Next
              </Button>
            ) : (
              <Button
                variant="contained"
                color="success"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Create Claim"}
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
