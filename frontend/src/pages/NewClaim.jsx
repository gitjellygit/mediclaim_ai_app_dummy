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

const steps = [
  "Patient & Hospital",
  "Admission & Diagnosis",
  "Policy & Insurance",
  "Financials",
  "Review"
];

const ICD_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

export default function NewClaim() {
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = React.useState(0);
  const [errors, setErrors] = React.useState({});
  const [submitting, setSubmitting] = React.useState(false);

  const [form, setForm] = React.useState({
    // Patient
    patientName: "",
    patientAge: "",
    patientGender: "",

    // Hospital / admission
    hospitalName: "",
    diagnosisText: "",
    icd10Codes: "",

    // Policy
    payerName: "",
    policyNo: "",

    // Financials
    claimType: "REIMBURSEMENT",
    totalBilledAmount: "",
    amount: ""
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
      alert("Patient name, insurance company and claimed amount are required");
      return;
    }
  
    const amount = Number(form.amount);
    const billed = form.totalBilledAmount
      ? Number(form.totalBilledAmount)
      : null;
  
    if (Number.isNaN(amount)) {
      alert("Claimed amount must be a valid number");
      return;
    }
  
    if (billed !== null && Number.isNaN(billed)) {
      alert("Billed amount must be a valid number");
      return;
    }
  
    try {
      setSubmitting(true);
  
      const payload = {
        patientName: form.patientName,
        payerName: form.payerName,
        policyNo: form.policyNo || null,
        hospitalName: form.hospitalName || null,
        diagnosisText: form.diagnosisText || null,
        claimType: form.claimType,
  
        amount,
        totalBilledAmount: billed,
  
        icd10Codes: form.icd10Codes
          ? form.icd10Codes.split(",").map(c => c.trim())
          : []
      };
  
      await ClaimsApi.create(payload);
      navigate("/claims");
    } catch (e) {
      alert(e.message || "Failed to create claim");
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
            </Stack>
          )}

          {/* STEP 3 */}
          {activeStep === 2 && (
            <Stack spacing={2}>
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
                <MenuItem value="REIMBURSEMENT">Reimbursement</MenuItem>
                <MenuItem value="CASHLESS">Cashless</MenuItem>
              </TextField>

              <TextField
                label="Total Billed Amount (₹)"
                type="number"
                value={form.totalBilledAmount}
                onChange={(e) =>
                  update("totalBilledAmount", e.target.value)
                }
              />

              <TextField
                label="Total Claimed Amount (₹)"
                type="number"
                value={form.amount}
                onChange={(e) => update("amount", e.target.value)}
                error={!!errors.amount}
                helperText={errors.amount}
              />
            </Stack>
          )}

          {/* STEP 5 – REVIEW (NO RAW JSON) */}
          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h6">Review Summary</Typography>

              <Divider />
              <Typography><b>Patient:</b> {form.patientName}</Typography>
              <Typography><b>Hospital:</b> {form.hospitalName || "—"}</Typography>

              <Divider />
              <Typography><b>Diagnosis:</b> {form.diagnosisText || "—"}</Typography>
              <Typography><b>ICD-10:</b> {form.icd10Codes || "—"}</Typography>

              <Divider />
              <Typography><b>Insurance:</b> {form.payerName}</Typography>
              <Typography><b>Policy No:</b> {form.policyNo || "—"}</Typography>

              <Divider />
              <Typography>
                <b>Billed:</b> ₹{form.totalBilledAmount || "—"} &nbsp; | &nbsp;
                <b> Claimed:</b> ₹{form.amount}
              </Typography>
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
