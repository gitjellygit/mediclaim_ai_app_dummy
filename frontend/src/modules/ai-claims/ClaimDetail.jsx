import React from "react";
import {
  Box, Card, CardContent, Typography, Button, Chip, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TablePagination,
  LinearProgress, Divider, TextField, Paper, Checkbox, IconButton, Tooltip,
  Collapse, Alert, Snackbar
} from "@mui/material";
import {
  DeleteForever, ExpandMore, ExpandLess, Visibility, Download, 
  SelectAll, DeselectAll, DeleteSweep, FolderOpen
} from "@mui/icons-material";
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
  
  // Table state
  const [selectedDocs, setSelectedDocs] = React.useState(new Set());
  const [expandedRows, setExpandedRows] = React.useState(new Set());
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [bulkDeleteLoading, setBulkDeleteLoading] = React.useState(false);

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

  // Table management functions
  function handleSelectDoc(docId) {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedDocs(newSelected);
  }

  function handleSelectAll() {
    if (!claim?.documents) return;
    
    if (selectedDocs.size === claim.documents.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(claim.documents.map(doc => doc.id)));
    }
  }

  function handleToggleExpand(docId) {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(docId)) {
      newExpanded.delete(docId);
    } else {
      newExpanded.add(docId);
    }
    setExpandedRows(newExpanded);
  }

  async function handleBulkDelete() {
    if (selectedDocs.size === 0) {
      showToast("Please select documents to delete", "warning");
      return;
    }

    if (!canDeleteDoc) return showToast("Only CASHIER/ADMIN can delete documents", "error");
    
    if (!confirm(`Delete ${selectedDocs.size} selected document(s)? This cannot be undone.`)) return;

    try {
      setBulkDeleteLoading(true);
      const deletePromises = Array.from(selectedDocs).map(docId => ClaimsApi.deleteDoc(docId));
      await Promise.all(deletePromises);
      
      showToast(`${selectedDocs.size} document(s) deleted successfully`, "success");
      setSelectedDocs(new Set());
      await load();
    } catch (e) {
      showToast(e.message || "Failed to delete documents", "error");
    } finally {
      setBulkDeleteLoading(false);
    }
  }

  async function handlePreview(doc) {
    try {
      const response = await fetch(`/api/documents/${doc.id}/preview`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (e) {
      showToast("Failed to preview document", "error");
    }
  }

  async function handleDownload(doc) {
    try {
      const response = await fetch(`/api/documents/${doc.id}/download`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      showToast("Failed to download document", "error");
    }
  }

  const paginatedDocs = claim?.documents?.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage) || [];

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
          <Button color="error" startIcon={<DeleteForever />} onClick={deleteClaim}>
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
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              Documents ({claim.documents.length})
            </Typography>
            
            {selectedDocs.size > 0 && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  {selectedDocs.size} selected
                </Typography>
                <Tooltip title="Delete Selected">
                  <IconButton 
                    color="error" 
                    onClick={handleBulkDelete}
                    disabled={bulkDeleteLoading || !canDeleteDoc}
                    size="small"
                  >
                    <DeleteSweep />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
          </Stack>

          <Stack direction="row" spacing={2} sx={{ mb: 3, alignItems: "center" }}>
            <TextField
              select
              label="Document Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </TextField>

            <Button
              variant="contained"
              component="label"
              startIcon={<FolderOpen />}
              size="small"
            >
              Upload Document
              <input
                type="file"
                hidden
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
            </Button>

            {claim?.documents?.length > 0 && (
              <Stack direction="row" spacing={1}>
                <Tooltip title={selectedDocs.size === claim?.documents?.length ? "Deselect All" : "Select All"}>
                  <IconButton 
                    size="small"
                    onClick={handleSelectAll}
                    color={selectedDocs.size === claim?.documents?.length ? "primary" : "default"}
                  >
                    {selectedDocs.size === claim?.documents?.length ? <DeselectAll /> : <SelectAll />}
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
          </Stack>

          {claim?.documents?.length > 0 ? (
            <>
              <TableContainer component={Paper} sx={{ border: '1px solid #e0e0e0', borderRadius: 1 }}>
                <Table stickyHeader aria-label="documents table">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                      <TableCell padding="checkbox" sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold' }}>
                        <Checkbox
                          indeterminate={selectedDocs.size > 0 && selectedDocs.size < claim?.documents?.length}
                          checked={claim?.documents?.length > 0 && selectedDocs.size === claim?.documents?.length}
                          onChange={handleSelectAll}
                          size="small"
                        />
                      </TableCell>
                      <TableCell sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', minWidth: 120 }}>
                        Type
                      </TableCell>
                      <TableCell sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', minWidth: 200 }}>
                        File Name
                      </TableCell>
                      <TableCell sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', minWidth: 150 }}>
                        AI Suggestion
                      </TableCell>
                      <TableCell sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', minWidth: 100 }}>
                        Confidence
                      </TableCell>
                      <TableCell sx={{ borderBottom: '2px solid #e0e0e0', fontWeight: 'bold', minWidth: 180 }}>
                        Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedDocs.map((doc) => (
                      <React.Fragment key={doc.id}>
                        <TableRow 
                          hover
                          selected={selectedDocs.has(doc.id)}
                          sx={{ '&:hover': { backgroundColor: '#f9f9f9' } }}
                        >
                          <TableCell padding="checkbox" sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            <Checkbox
                              checked={selectedDocs.has(doc.id)}
                              onChange={() => handleSelectDoc(doc.id)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            <Chip
                              label={doc.type.replace('_', ' ')}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                {doc.fileName}
                              </Typography>
                              <Tooltip title="Expand Details">
                                <IconButton 
                                  size="small"
                                  onClick={() => handleToggleExpand(doc.id)}
                                  sx={{ p: 0.5 }}
                                >
                                  {expandedRows.has(doc.id) ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            {doc.suggestedType ? (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  label={`${doc.suggestedType.replace('_', ' ')}`}
                                />
                                {doc.suggestedType !== doc.type && canDeleteDoc && (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => applyDocSuggestion(doc)}
                                    sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}
                                  >
                                    Apply
                                  </Button>
                                )}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                No suggestion
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            {doc.confidence ? (
                              <Chip
                                label={`${doc.confidence}%`}
                                size="small"
                                color={doc.confidence >= 85 ? 'success' : doc.confidence >= 70 ? 'warning' : 'error'}
                              />
                            ) : (
                              <Typography variant="body2" color="text.secondary">-</Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #e0e0e0' }}>
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title="Preview">
                                <IconButton 
                                  size="small"
                                  onClick={() => handlePreview(doc)}
                                  sx={{ color: 'primary.main' }}
                                >
                                  <Visibility fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Download">
                                <IconButton 
                                  size="small"
                                  onClick={() => handleDownload(doc)}
                                  sx={{ color: 'primary.main' }}
                                >
                                  <Download fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              {canDeleteDoc && (
                                <Tooltip title="Delete">
                                  <IconButton 
                                    size="small"
                                    onClick={async () => {
                                      if (!confirm("Delete this document?")) return;
                                      try {
                                        await ClaimsApi.deleteDoc(doc.id);
                                        showToast("Document deleted", "warning");
                                        await load();
                                      } catch (err) {
                                        showToast(err.message || "Delete failed", "error");
                                      }
                                    }}
                                    sx={{ color: 'error.main' }}
                                  >
                                    <DeleteForever fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={6} sx={{ p: 0, borderBottom: '1px solid #e0e0e0' }}>
                            <Collapse in={expandedRows.has(doc.id)} timeout="auto" unmountOnExit>
                              <Box sx={{ p: 2, backgroundColor: '#fafafa' }}>
                                <Stack spacing={1}>
                                  <Typography variant="subtitle2" fontWeight="bold">
                                    Document Details
                                  </Typography>
                                  <Stack direction="row" spacing={2} flexWrap="wrap">
                                    <Typography variant="body2">
                                      <strong>Size:</strong> {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : 'Unknown'}
                                    </Typography>
                                    <Typography variant="body2">
                                      <strong>MIME Type:</strong> {doc.mimeType || 'Unknown'}
                                    </Typography>
                                    <Typography variant="body2">
                                      <strong>Uploaded:</strong> {doc.createdAt ? new Date(doc.createdAt).toLocaleString() : 'Unknown'}
                                    </Typography>
                                    <Typography variant="body2">
                                      <strong>Status:</strong> {doc.status || 'PENDING'}
                                    </Typography>
                                  </Stack>
                                  {doc.extracted && Object.keys(doc.extracted).length > 0 && (
                                    <Box sx={{ mt: 1 }}>
                                      <Typography variant="subtitle2" fontWeight="bold">
                                        Extracted Data
                                      </Typography>
                                      {Object.entries(doc.extracted).map(([key, value]) => (
                                        <Typography key={key} variant="body2" sx={{ pl: 2 }}>
                                          <strong>{key}:</strong> {value}
                                        </Typography>
                                      ))}
                                    </Box>
                                  )}
                                </Stack>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              
              <TablePagination
                rowsPerPageOptions={[5, 10, 25, 50]}
                component="div"
                count={claim?.documents?.length || 0}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={(e, newPage) => setPage(newPage)}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                sx={{ border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 8px 8px' }}
              />
            </>
          ) : (
            <Alert severity="info" sx={{ mt: 2 }}>
              No documents uploaded yet. Upload documents to get started with AI analysis.
            </Alert>
          )}
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