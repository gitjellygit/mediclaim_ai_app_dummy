import React from "react";
import {
  Box, Card, CardContent, Typography, Button, Chip, Stack,
  Table, TableHead, TableRow, TableCell, TableBody,
  LinearProgress, Divider, TextField
} from "@mui/material";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { useParams, useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { AuthApi } from "../../api/auth.js";
import { useToast } from "../../context/ToastContext.jsx";
import AICheckProgress from "../../components/AICheckProgress.jsx";

const DOC_TYPES = [
  "DISCHARGE_SUMMARY", "FINAL_BILL", "BREAKUP_BILL", "LAB_REPORT", "RADIOLOGY",
  "PRESCRIPTION", "ID_PROOF", "INSURANCE_CARD", "OTHER"
];

const STATUS_COLOR = {
  DRAFT: "default",
  READY: "primary",
  SUBMITTED: "warning",
  PAID: "success",
  REJECTED: "error"
};

function pct(x) {
  if (typeof x !== "number") return "—";
  return `${Math.round(x * 100)}%`;
}

function riskChipColor(level) {
  if (level === "HIGH") return "error";
  if (level === "MED") return "warning";
  if (level === "LOW") return "success";
  return "default";
}

export default function ClaimDetail({ id: idProp, onBack: onBackProp }) {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const id = idProp ?? idParam;
  const onBack = onBackProp ?? (() => navigate("/claims"));

  const { showToast } = useToast();
  const user = AuthApi.getUser();
  const isAdmin = user?.role === "ADMIN";
  const canRunAI = user?.role === "ADMIN" || user?.role === "CASHIER";
  const canDeleteDoc = user?.role === "ADMIN" || user?.role === "CASHIER";
  const canEditClaim = !!user;

  const [claim, setClaim] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [docType, setDocType] = React.useState("FINAL_BILL");
  const [aiRunning, setAiRunning] = React.useState(false);
  const [submittingClaim, setSubmittingClaim] = React.useState(false);
  const [editMode, setEditMode] = React.useState(false);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [editForm, setEditForm] = React.useState(null);

  async function load() {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await ClaimsApi.get(id);
      setClaim(data);
    } catch (e) {
      setClaim(null);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [id]);

  React.useEffect(() => {
    if (!claim) return;
    setEditForm({
      patientName: claim.patientName || "",
      payerName: claim.payerName || "",
      policyNo: claim.policyNo || "",
      hospitalName: claim.hospitalName || "",
      diagnosisText: claim.diagnosisText || "",
      icd10Codes: claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "",
      amount: claim.amount != null ? String(claim.amount) : "",
      totalBilledAmount: claim.totalBilledAmount != null ? String(claim.totalBilledAmount) : "",
      claimType: claim.claimType || "REIMBURSEMENT"
    });
  }, [claim]);

  function updateEditField(key, value) {
    setEditForm((f) => ({ ...(f || {}), [key]: value }));
  }

  function resetEditForm() {
    if (!claim) return;
    setEditForm({
      patientName: claim.patientName || "",
      payerName: claim.payerName || "",
      policyNo: claim.policyNo || "",
      hospitalName: claim.hospitalName || "",
      diagnosisText: claim.diagnosisText || "",
      icd10Codes: claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "",
      amount: claim.amount != null ? String(claim.amount) : "",
      totalBilledAmount: claim.totalBilledAmount != null ? String(claim.totalBilledAmount) : "",
      claimType: claim.claimType || "REIMBURSEMENT"
    });
  }

  async function saveEdit() {
    if (!editForm) return;

    const payload = {
      patientName: editForm.patientName?.trim(),
      payerName: editForm.payerName?.trim(),
      policyNo: editForm.policyNo || null,
      hospitalName: editForm.hospitalName || null,
      diagnosisText: editForm.diagnosisText || null,
      claimType: editForm.claimType,
      amount: parseFloat(editForm.amount),
      totalBilledAmount: parseFloat(editForm.totalBilledAmount) || null,
      icd10Codes: editForm.icd10Codes
        ? editForm.icd10Codes.split(",").map((c) => c.trim()).filter(Boolean)
        : []
    };

    if (!payload.patientName || payload.patientName.length === 0) {
      return showToast("Patient name is required", "error");
    }
    if (!payload.payerName || payload.payerName.length === 0) {
      return showToast("Insurance company is required", "error");
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return showToast("Claimed amount must be a valid number greater than 0", "error");
    }

    try {
      setSavingEdit(true);
      const updated = await ClaimsApi.update(id, payload);
      setClaim(updated);
      setEditMode(false);
      showToast("Claim details updated", "success");
    } catch (e) {
      showToast(e.message || "Failed to update claim", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteClaim() {
    if (!isAdmin) return showToast("Only ADMIN can delete claims", "error");
    if (!confirm("This will permanently delete the claim. Continue?")) return;

    try {
      await ClaimsApi.delete(id);
      showToast("Claim deleted", "warning");
      onBack();
    } catch (e) {
      showToast(e.message || "Failed to delete claim", "error");
    }
  }

  async function runAICheck() {
    if (!canRunAI) return showToast("Only CASHIER/ADMIN can run AI check", "error");

    try {
      setAiRunning(true);
      await new Promise((r) => setTimeout(r, 2500));
      await ClaimsApi.runCheck(id);
      await load();
      showToast("AI analysis completed", "success");
    } catch (e) {
      showToast(e.message || "AI analysis failed", "error");
    } finally {
      setAiRunning(false);
    }
  }

  async function submitClaim() {
    try {
      setSubmittingClaim(true);
      await ClaimsApi.submit(id);
      await load();
      showToast("Claim submitted successfully", "success");
    } catch (e) {
      showToast(e.message || "Failed to submit claim", "error");
    } finally {
      setSubmittingClaim(false);
    }
  }

  async function applyDocSuggestion(doc) {
    if (!canDeleteDoc) return showToast("Only CASHIER/ADMIN can apply suggestion", "error");
    if (!doc?.suggestedType) return;

    try {
      await ClaimsApi.applyDocumentSuggestion(doc.id);
      showToast("Applied AI suggested type", "success");
      await load();
    } catch (e) {
      showToast(e.message || "Failed to apply suggestion", "error");
    }
  }

  if (!id) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
        <Typography color="error">No claim selected.</Typography>
        <Button onClick={onBack} sx={{ mt: 2 }}>← Back to list</Button>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
        <LinearProgress sx={{ mb: 2 }} />
        <Typography>Loading claim...</Typography>
      </Box>
    );
  }

  if (!claim) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
        <Typography color="error">Claim not found.</Typography>
        <Button onClick={onBack} sx={{ mt: 2 }}>← Back to list</Button>
      </Box>
    );
  }

  const check = claim.checks?.[0];
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const hasBlock = issues.some((i) => i.severity === "BLOCK");
  const canSubmit =
    claim.status !== "SUBMITTED" &&
    !!check &&
    !hasBlock &&
    (check?.score ?? 0) >= 80;

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
        <Button onClick={onBack}>← Back to list</Button>

        {isAdmin && (
          <Button color="error" startIcon={<DeleteForeverIcon />} onClick={deleteClaim}>
            Delete Claim
          </Button>
        )}
      </Stack>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h5">{claim.patientName}</Typography>
          <Typography color="text.secondary">
            {claim.hospitalName || "Hospital"} • {claim.payerName}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Chip label={claim.status} color={STATUS_COLOR[claim.status]} />
            <Chip label={claim.claimType} variant="outlined" />
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Patient & Policy</Typography>

            {canEditClaim && !editMode && (
              <Button size="small" onClick={() => setEditMode(true)}>Edit</Button>
            )}

            {canEditClaim && editMode && (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  disabled={savingEdit}
                  onClick={() => {
                    resetEditForm();
                    setEditMode(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={savingEdit}
                  onClick={saveEdit}
                >
                  {savingEdit ? "Saving..." : "Save"}
                </Button>
              </Stack>
            )}
          </Stack>

          <Divider sx={{ my: 1 }} />

          {!editMode && (
            <>
              <Typography><b>Diagnosis:</b> {claim.diagnosisText || "—"}</Typography>
              <Typography><b>ICD-10:</b> {claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "—"}</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography><b>Policy No:</b> {claim.policyNo || "Not provided"}</Typography>
              <Typography><b>TPA:</b> {claim.tpaName || "—"}</Typography>
            </>
          )}

          {editMode && editForm && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Patient Name"
                value={editForm.patientName}
                onChange={(e) => updateEditField("patientName", e.target.value)}
                fullWidth
              />
              <TextField
                label="Hospital Name"
                value={editForm.hospitalName}
                onChange={(e) => updateEditField("hospitalName", e.target.value)}
                fullWidth
              />
              <TextField
                label="Diagnosis"
                value={editForm.diagnosisText}
                onChange={(e) => updateEditField("diagnosisText", e.target.value)}
                fullWidth
              />
              <TextField
                label="ICD-10 Codes (comma separated)"
                value={editForm.icd10Codes}
                onChange={(e) => updateEditField("icd10Codes", e.target.value)}
                fullWidth
              />
              <TextField
                label="Insurance Company"
                value={editForm.payerName}
                onChange={(e) => updateEditField("payerName", e.target.value)}
                fullWidth
              />
              <TextField
                label="Policy Number"
                value={editForm.policyNo}
                onChange={(e) => updateEditField("policyNo", e.target.value)}
                fullWidth
              />
              <TextField
                label="Total Billed Amount (₹)"
                type="number"
                value={editForm.totalBilledAmount}
                onChange={(e) => updateEditField("totalBilledAmount", e.target.value)}
                fullWidth
              />
              <TextField
                label="Total Claimed Amount (₹)"
                type="number"
                value={editForm.amount}
                onChange={(e) => updateEditField("amount", e.target.value)}
                fullWidth
              />
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6">Documents</Typography>

          <Stack direction="row" spacing={2} sx={{ my: 2, alignItems: "center" }}>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <input
              type="file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                try {
                  await ClaimsApi.uploadDoc({ claimId: id, type: docType, file });
                  showToast("Document uploaded (AI analyzed)", "success");
                  await load();
                } catch (err) {
                  showToast(err.message || "Upload failed", "error");
                }

                e.target.value = "";
              }}
            />
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>File</TableCell>
                <TableCell>AI Suggestion</TableCell>
                <TableCell width={140}>Action</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {claim.documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.type}</TableCell>
                  <TableCell>{d.fileName}</TableCell>

                  <TableCell>
                    {d.suggestedType ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip
                          size="small"
                          variant="outlined"
                          color="primary"
                          label={`${d.suggestedType} (${d.confidence ?? 0}%)`}
                        />
                        {d.suggestedType !== d.type && (
                          <Button
                            size="small"
                            disabled={!canDeleteDoc}
                            onClick={() => applyDocSuggestion(d)}
                          >
                            Apply
                          </Button>
                        )}
                      </Stack>
                    ) : (
                      <Typography color="text.secondary">—</Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Button
                      color="error"
                      size="small"
                      disabled={!canDeleteDoc}
                      onClick={async () => {
                        if (!canDeleteDoc) return showToast("Only CASHIER/ADMIN can delete documents", "error");
                        if (!confirm("Delete this document?")) return;

                        try {
                          await ClaimsApi.deleteDoc(d.id);
                          showToast("Document deleted", "warning");
                          await load();
                        } catch (err) {
                          showToast(err.message || "Delete failed", "error");
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}

              {!claim.documents.length && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No documents uploaded yet</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Typography variant="h6">AI Readiness & Rejection Risk</Typography>

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={runAICheck}
                disabled={aiRunning || !canRunAI}
              >
                Run AI Check
              </Button>

              <Button
                variant="contained"
                color="success"
                onClick={submitClaim}
                disabled={!canSubmit || submittingClaim}
              >
                {claim.status === "SUBMITTED"
                  ? "Already Submitted"
                  : submittingClaim
                  ? "Submitting..."
                  : "Submit Claim"}
              </Button>
            </Stack>
          </Stack>

          {check && (
            <>
              <Typography sx={{ mt: 2 }}>
                Readiness Score: <b>{check.score}/100</b>
              </Typography>

              <LinearProgress
                variant="determinate"
                value={check.score}
                sx={{ height: 10, borderRadius: 5, my: 2 }}
              />

              <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
                <Chip
                  label={`Rejection Risk: ${pct(check.riskScore)} (${check.riskLevel || "—"})`}
                  color={riskChipColor(check.riskLevel)}
                />

                {canSubmit && claim.status !== "SUBMITTED" && (
                  <Chip label="Ready for submission" color="success" />
                )}
              </Stack>

              {Array.isArray(check.riskFactors) && check.riskFactors.length > 0 && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="subtitle2">Top risk drivers</Typography>
                  {check.riskFactors.map((f, idx) => (
                    <Chip key={idx} label={f} variant="outlined" />
                  ))}
                </Stack>
              )}

              {check.issues?.length === 0 ? (
                <Chip label="Claim is ready for submission" color="success" sx={{ mt: 2 }} />
              ) : (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  {check.issues.map((i, idx) => (
                    <Chip
                      key={idx}
                      label={i.message}
                      color={i.severity === "BLOCK" ? "error" : "warning"}
                    />
                  ))}
                </Stack>
              )}
            </>
          )}

          {!check && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Run AI Check first. Submission will be enabled only when the claim is ready.
            </Typography>
          )}
        </CardContent>
      </Card>

      <AICheckProgress open={aiRunning} />
    </Box>
  );
}