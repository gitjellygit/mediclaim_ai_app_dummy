import React from "react";
import {
  Box, Card, CardContent, Typography, Button, Chip, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TablePagination,
  LinearProgress, Divider, TextField, Paper, Checkbox, IconButton, Tooltip,
  Collapse, Alert, Snackbar, MenuItem
} from "@mui/material";
import {
  DeleteForever, ExpandMore, ExpandLess, Visibility, Download, 
  SelectAll, CheckBox, CheckBoxOutlineBlank, DeleteSweep, FolderOpen, BuildCircle
} from "@mui/icons-material";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { AuthApi } from "../../api/auth.js";
import { useToast } from "../../context/ToastContext.jsx";
import AICheckProgress from "../../components/AICheckProgress.jsx";
import { api } from "../../api/client.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const DOC_TYPES = [
  "DISCHARGE_SUMMARY",
  "FINAL_BILL",
  "BREAKUP_BILL",
  "LAB_REPORT",
  "RADIOLOGY",
  "PRESCRIPTION",
  "ID_PROOF",
  "INSURANCE_CARD",
  "PRIOR_AUTHORIZATION",
  "OPERATIVE_NOTE",
  "PROGRESS_NOTE",
  "EOB",
  "OTHER"
];

const DOC_TYPE_LABELS = {
  DISCHARGE_SUMMARY: "Discharge Summary",
  FINAL_BILL: "Final Bill",
  BREAKUP_BILL: "Itemized / Breakup Bill",
  LAB_REPORT: "Lab Report",
  RADIOLOGY: "Radiology Report",
  PRESCRIPTION: "Prescription",
  ID_PROOF: "ID Proof",
  INSURANCE_CARD: "Insurance Card",
  PRIOR_AUTHORIZATION: "Prior Authorization",
  OPERATIVE_NOTE: "Operative Note",
  PROGRESS_NOTE: "Progress Note",
  EOB: "Explanation of Benefits (EOB)",
  OTHER: "Other"
};

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatMoney(value) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount);
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
  const location = useLocation();
  const id = idProp ?? idParam;
  const returnTo = location.state?.from || "/claims";
  const backLabel = location.state?.backLabel || "Back to Claims";
  const onBack = onBackProp ?? (() => navigate(returnTo));

  const { showToast, showDialog, confirmDialog } = useToast();
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
  const [fixFocus, setFixFocus] = React.useState("");
  const patientPolicyRef = React.useRef(null);
  const documentsRef = React.useRef(null);
  const readinessRef = React.useRef(null);

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
      memberId: claim.memberId || "",
      patientDob: claim.patientDob
        ? new Date(claim.patientDob).toISOString().slice(0, 10)
        : "",
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
      memberId: claim.memberId || "",
      patientDob: claim.patientDob
        ? new Date(claim.patientDob).toISOString().slice(0, 10)
        : "",
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
    if (claim?.status === "SUBMITTED") {
      return showDialog(
        "Submitted claims are locked. Reopen or amend the claim before editing.",
        { title: "Claim is locked", severity: "warning" }
      );
    }

    const payload = {
      patientName: editForm.patientName?.trim(),
      payerName: editForm.payerName?.trim(),
      policyNo: editForm.policyNo || null,
      memberId: editForm.memberId || null,
      patientDob: editForm.patientDob || null,
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
      return showDialog(
        "Patient name is required",
        { title: "Missing patient name", severity: "warning" }
      );
    }
    if (!payload.payerName || payload.payerName.length === 0) {
      return showDialog(
        "Insurance company is required",
        { title: "Missing insurance company", severity: "warning" }
      );
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return showDialog(
        "Claimed amount must be a valid number greater than 0",
        { title: "Invalid claimed amount", severity: "warning" }
      );
    }

    try {
      setSavingEdit(true);
      const updated = await ClaimsApi.update(id, payload);
      setClaim(updated);
      setEditMode(false);
      setFixFocus("");
      showToast("Claim details updated", "success");
    } catch (e) {
      showDialog(
        e.message || "The claim could not be updated. Please try again.",
        { title: "Claim update failed", severity: "error" }
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteClaim() {
    if (!isAdmin) {
      return showDialog(
        "Only an ADMIN can permanently delete a claim.",
        { title: "Permission required", severity: "warning" }
      );
    }

    const confirmed = await confirmDialog(
      "This will permanently delete the claim and its associated documents. This action cannot be undone.",
      {
        title: "Delete claim?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!confirmed) return;

    try {
      await ClaimsApi.delete(id);
      showToast("Claim deleted", "warning");
      onBack();
    } catch (e) {
      showDialog(
        e.message || "The claim could not be deleted.",
        { title: "Claim could not be deleted", severity: "error" }
      );
    }
  }

  function scrollToRef(ref) {
    window.setTimeout(() => {
      ref?.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
  }

  function openClaimEdit(focus = "claim") {
    if (claim?.status === "SUBMITTED") {
      showDialog(
        "Submitted claims are locked. This issue cannot be edited unless the claim is reopened or amended.",
        { title: "Claim is locked", severity: "warning" }
      );
      return;
    }

    setFixFocus(focus);
    setEditMode(true);
    scrollToRef(patientPolicyRef);
  }

  function fixIssue(issue) {
    const message = String(issue?.message || "").toLowerCase();

    if (message.includes("supporting document")) {
      setFixFocus("documents");
      scrollToRef(documentsRef);
      return;
    }

    if (message.includes("eligibility")) {
      navigate(`/journey?claimId=${claim.id}`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }

    if (message.includes("prior authorization")) {
      navigate(`/journey?claimId=${claim.id}`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }

    if (message.includes("policy")) {
      openClaimEdit("policyNo");
      return;
    }

    if (message.includes("icd")) {
      openClaimEdit("icd10Codes");
      return;
    }

    if (message.includes("amount")) {
      openClaimEdit("amount");
      return;
    }

    openClaimEdit("claim");
  }

  function fixButtonLabel(issue) {
    const message = String(issue?.message || "").toLowerCase();
    if (message.includes("supporting document")) return "Upload Document";
    if (message.includes("eligibility")) return "Verify Eligibility";
    if (message.includes("prior authorization")) return "Resolve Auth";
    return "Fix";
  }

  React.useEffect(() => {
    if (!claim || !location.state?.focus) return;

    if (location.state.focus === "eligibility") {
      openClaimEdit("eligibility");
    }
    // Only consume this navigation hint once for the loaded claim.
    navigate(location.pathname + location.search, {
      replace: true,
      state: {
        from: location.state?.from,
        backLabel: location.state?.backLabel
      }
    });
  }, [claim?.id]);

  async function runAICheck() {
    if (!canRunAI) return showToast("Only CASHIER/ADMIN can run AI check", "error");
    if (claim?.status === "SUBMITTED") {
      return showDialog(
        "Submitted claims are locked. Reopen the claim before running a new AI check.",
        { title: "AI check unavailable", severity: "warning" }
      );
    }

    try {
      setAiRunning(true);
      await new Promise((r) => setTimeout(r, 2500));
      await ClaimsApi.runCheck(id);
      await load();
      showToast("AI analysis completed", "success");
    } catch (e) {
      showDialog(
        e.message || "AI analysis could not be completed. Please try again.",
        { title: "AI analysis failed", severity: "error" }
      );
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
      showDialog(
        e.message || "The claim could not be submitted.",
        { title: "Claim submission failed", severity: "error" }
      );
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
      showDialog(
        e.message || "The AI suggestion could not be applied.",
        { title: "Suggestion could not be applied", severity: "error" }
      );
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
      showDialog(
        "Select at least one document before using bulk delete.",
        { title: "No documents selected", severity: "warning" }
      );
      return;
    }

    if (!canDeleteDoc) {
      return showDialog(
        "Only CASHIER or ADMIN users can delete documents.",
        { title: "Permission required", severity: "warning" }
      );
    }
    
    const confirmed = await confirmDialog(
      `Delete ${selectedDocs.size} selected document${selectedDocs.size === 1 ? "" : "s"}? This cannot be undone.`,
      {
        title: "Delete selected documents?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!confirmed) return;

    try {
      setBulkDeleteLoading(true);
      const deletePromises = Array.from(selectedDocs).map(docId => ClaimsApi.deleteDoc(docId));
      await Promise.all(deletePromises);
      
      showToast(`${selectedDocs.size} document(s) deleted successfully`, "success");
      setSelectedDocs(new Set());
      await load();
    } catch (e) {
      showDialog(
        e.message || "The selected documents could not be deleted.",
        { title: "Documents could not be deleted", severity: "error" }
      );
    } finally {
      setBulkDeleteLoading(false);
    }
  }

  async function handlePreview(doc) {
    try {
      console.log("Previewing document:", doc.id, doc.fileName);
      
      // Check if we have a token
      const token = localStorage.getItem('accessToken');
      console.log("Token available:", !!token);
      console.log("Token length:", token?.length || 0);
      
      if (!token) {
        console.error("No authentication token found");
        showDialog(
          "Your session is missing or has expired. Please log in again to preview documents.",
          { title: "Sign-in required", severity: "warning" }
        );
        return;
      }
      
      // Use API_BASE for direct backend connection
      const response = await fetch(`${API_BASE}/api/documents/${doc.id}/preview`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log("Response status:", response.status);
      console.log("Response headers:", [...response.headers.entries()]);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Preview response not ok:", response.status, response.statusText, errorText);
        showDialog(
          errorText || `Preview failed: ${response.statusText}`,
          { title: "Document preview failed", severity: "error" }
        );
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      // Check if it's a PDF and open in new tab
      if (doc.mimeType?.includes("pdf")) {
        window.open(url, '_blank');
      } else {
        // For non-PDFs, try to download instead
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      
      // Clean up the URL after a delay
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      
    } catch (e) {
      console.error("Preview error:", e);
      showDialog(
        e?.message || "The document preview could not be loaded. Please try again.",
        { title: "Document preview failed", severity: "error" }
      );
    }
  }

  async function handleDownload(doc) {
    try {
      console.log("Downloading document:", doc.id, doc.fileName);
      
      // Check if we have a token
      const token = localStorage.getItem('accessToken');
      console.log("Token available:", !!token);
      console.log("Token length:", token?.length || 0);
      
      if (!token) {
        console.error("No authentication token found");
        showDialog(
          "Your session is missing or has expired. Please log in again to download documents.",
          { title: "Sign-in required", severity: "warning" }
        );
        return;
      }
      
      // Use API_BASE for direct backend connection
      const response = await fetch(`${API_BASE}/api/documents/${doc.id}/download`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log("Response status:", response.status);
      console.log("Response headers:", [...response.headers.entries()]);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Download response not ok:", response.status, response.statusText, errorText);
        showDialog(
          errorText || `Download failed: ${response.statusText}`,
          { title: "Document download failed", severity: "error" }
        );
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showToast("Document downloaded successfully", "success");
    } catch (e) {
      console.error("Download error:", e);
      showDialog(
        e?.message || "The document could not be downloaded. Please try again.",
        { title: "Document download failed", severity: "error" }
      );
    }
  }

  const paginatedDocs = claim?.documents?.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage) || [];

  if (!id) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: { xs: 1, sm: 2, lg: 3 } }}>
        <Typography color="error">No claim selected.</Typography>
        <Button onClick={onBack} sx={{ mt: 2 }}>← {backLabel}</Button>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: { xs: 1, sm: 2, lg: 3 } }}>
        <LinearProgress sx={{ mb: 2 }} />
        <Typography>Loading claim...</Typography>
      </Box>
    );
  }

  if (!claim) {
    return (
      <Box sx={{ maxWidth: 1200, mx: "auto", p: { xs: 1, sm: 2, lg: 3 } }}>
        <Typography color="error">Claim not found.</Typography>
        <Button onClick={onBack} sx={{ mt: 2 }}>← {backLabel}</Button>
      </Box>
    );
  }

  const check = claim.checks?.[0];
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const hasBlock = issues.some((i) => i.severity === "BLOCK");
  const eligibilityClear = claim.eligibilityStatus === "VERIFIED";
  const priorAuthClear =
    claim.priorAuthStatus === "APPROVED" ||
    claim.priorAuthStatus === "NOT_REQUIRED";

  const canSubmit =
    claim.status !== "SUBMITTED" &&
    eligibilityClear &&
    priorAuthClear &&
    !!check &&
    !hasBlock &&
    (check?.score ?? 0) >= 80;

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: { xs: 1, sm: 2, lg: 3 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Button onClick={onBack}>← {backLabel}</Button>

        {isAdmin && claim.status !== "SUBMITTED" && (
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
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            <Chip label={claim.status} color={STATUS_COLOR[claim.status]} />
            <Chip label={claim.claimType} variant="outlined" />
            {claim.documents?.length > 1 && (
              <Chip
                label={`${claim.documents.length} documents consolidated in this claim`}
                color="success"
                variant="outlined"
              />
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card
        ref={patientPolicyRef}
        sx={{
          mb: 3,
          scrollMarginTop: 88,
          border:
            fixFocus &&
            ["eligibility", "policyNo", "icd10Codes", "amount", "claim"].includes(fixFocus)
              ? "2px solid"
              : undefined,
          borderColor: "warning.main"
        }}
      >
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Patient & Policy</Typography>

            {canEditClaim && claim.status !== "SUBMITTED" && !editMode && (
              <Button size="small" onClick={() => setEditMode(true)}>Edit</Button>
            )}
            {claim.status === "SUBMITTED" && (
              <Chip size="small" label="Locked after submission" variant="outlined" />
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
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Clinical
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
                  <Typography><b>Diagnosis:</b> {claim.diagnosisText || "—"}</Typography>
                  <Typography><b>ICD-10:</b> {claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "—"}</Typography>
                  <Typography><b>Doctor:</b> {claim.doctorName || "—"}</Typography>
                  <Typography><b>Hospital:</b> {claim.hospitalName || "—"}</Typography>
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Patient identity & coverage
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <Typography><b>Member ID:</b> {claim.memberId || "—"}</Typography>
                  <Typography><b>DOB:</b> {formatDate(claim.patientDob)}</Typography>
                  <Typography><b>Policy No:</b> {claim.policyNo || "—"}</Typography>
                  <Typography><b>Payer:</b> {claim.payerName || "—"}</Typography>
                  <Typography><b>TPA:</b> {claim.tpaName || "—"}</Typography>
                  <Typography><b>Policy Type:</b> {claim.productType || "—"}</Typography>
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Encounter
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <Typography><b>Date of Service:</b> {formatDate(claim.dateOfService)}</Typography>
                  <Typography><b>Admission:</b> {formatDate(claim.admissionDate)}</Typography>
                  <Typography><b>Discharge:</b> {formatDate(claim.dischargeDate)}</Typography>
                  <Typography><b>Admission Type:</b> {claim.admissionType || "—"}</Typography>
                  <Typography><b>Room Category:</b> {claim.roomCategory || "—"}</Typography>
                  <Typography><b>ICU Days:</b> {claim.icuDays ?? "—"}</Typography>
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Claim & financials
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <Typography><b>Total Billed:</b> {formatMoney(claim.totalBilledAmount)}</Typography>
                  <Typography><b>Claimed Amount:</b> {formatMoney(claim.amount)}</Typography>
                  <Typography><b>Approved Amount:</b> {formatMoney(claim.approvedAmount)}</Typography>
                  <Typography><b>Insurer Claim No:</b> {claim.insurerClaimNo || "—"}</Typography>
                  <Typography><b>Authorization No:</b> {claim.authorizationNo || "—"}</Typography>
                  <Typography><b>Submission Date:</b> {formatDate(claim.claimSubmissionDate)}</Typography>
                </Box>
              </Box>
            </Stack>
          )}

          {editMode && editForm && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {fixFocus && (
                <Alert severity="warning">
                  Review the highlighted claim information, update the missing or incorrect values,
                  then click Save Changes and rerun AI Check.
                </Alert>
              )}
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
                color={fixFocus === "icd10Codes" ? "warning" : "primary"}
                focused={fixFocus === "icd10Codes"}
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
                autoFocus={fixFocus === "policyNo"}
                color={fixFocus === "policyNo" ? "warning" : "primary"}
                focused={fixFocus === "policyNo"}
              />
              <TextField
                label="Member ID"
                value={editForm.memberId}
                onChange={(e) => updateEditField("memberId", e.target.value)}
                fullWidth
                autoFocus={fixFocus === "eligibility"}
                color={fixFocus === "eligibility" ? "warning" : "primary"}
                focused={fixFocus === "eligibility"}
                helperText={
                  fixFocus === "eligibility"
                    ? "Eligibility pre-check requires Member ID, Policy Number, and Insurance Company."
                    : ""
                }
              />
              <TextField
                label="Patient Date of Birth"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.patientDob}
                onChange={(e) => updateEditField("patientDob", e.target.value)}
                fullWidth
              />
              <TextField
                label="Total Billed Amount ($)"
                type="number"
                value={editForm.totalBilledAmount}
                onChange={(e) => updateEditField("totalBilledAmount", e.target.value)}
                fullWidth
              />
              <TextField
                label="Total Claimed Amount ($)"
                type="number"
                value={editForm.amount}
                color={fixFocus === "amount" ? "warning" : "primary"}
                focused={fixFocus === "amount"}
                onChange={(e) => updateEditField("amount", e.target.value)}
                fullWidth
              />
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card
        ref={documentsRef}
        sx={{
          mb: 3,
          scrollMarginTop: 88,
          border: fixFocus === "documents" ? "2px solid" : undefined,
          borderColor: "warning.main"
        }}
      >
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              Documents ({claim.documents.length})
            </Typography>
            
            {selectedDocs.size > 0 && claim.status !== "SUBMITTED" && (
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

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ mb: 3, alignItems: { xs: "stretch", sm: "center" } }}
          >
            <TextField
              select
              label="Document Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              size="small"
              sx={{
                minWidth: { xs: "100%", sm: 260 },
                "& .MuiSelect-select": { cursor: "pointer" }
              }}
              SelectProps={{
                MenuProps: {
                  PaperProps: {
                    sx: { maxHeight: 360 }
                  }
                }
              }}
              helperText="Choose the document you are uploading"
            >
              {DOC_TYPES.map((type) => (
                <MenuItem
                  key={type}
                  value={type}
                  sx={{ cursor: "pointer", py: 1.1 }}
                >
                  {DOC_TYPE_LABELS[type] || type.replaceAll("_", " ")}
                </MenuItem>
              ))}
            </TextField>

            <Button
              variant="contained"
              component="label"
              startIcon={<FolderOpen />}
              size="small"
              disabled={claim.status === "SUBMITTED"}
            >
              Upload Document
              <input
                type="file"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  try {
                    const result = await ClaimsApi.uploadDoc({
                      claimId: id,
                      type: docType,
                      file
                    });

                    if (result?.identityValidation?.status === "UNVERIFIED") {
                      showDialog(
                        result?.message ||
                          "The document was uploaded, but the patient identity could not be verified from the extracted data. Please review it before relying on this document.",
                        {
                          title: "Document uploaded — identity not verified",
                          severity: "warning"
                        }
                      );
                    } else {
                      showToast(
                        result?.message ||
                          "Document uploaded and patient identity matched the current claim.",
                        "success"
                      );
                    }

                    await load();
                  } catch (err) {
                    const isPatientMismatch =
                      err?.code === "DOCUMENT_PATIENT_MISMATCH" ||
                      /patient mismatch|appears to belong to/i.test(err?.message || "");

                    showDialog(
                      err?.message ||
                        "The document upload failed. Please try again.",
                      {
                        title: isPatientMismatch
                          ? "Wrong patient document"
                          : "Document upload failed",
                        severity: isPatientMismatch ? "warning" : "error"
                      }
                    );
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
                    {selectedDocs.size === claim?.documents?.length ? <CheckBoxOutlineBlank /> : <SelectAll />}
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
                              {canDeleteDoc && claim.status !== "SUBMITTED" && (
                                <Tooltip title="Delete">
                                  <IconButton 
                                    size="small"
                                    onClick={async () => {
                                      const confirmed = await confirmDialog(
                                        "Delete this document? This action cannot be undone.",
                                        {
                                          title: "Delete document?",
                                          severity: "warning",
                                          confirmLabel: "Delete",
                                          cancelLabel: "Cancel"
                                        }
                                      );
                                      if (!confirmed) return;
                                      try {
                                        await ClaimsApi.deleteDoc(doc.id);
                                        showToast("Document deleted", "warning");
                                        await load();
                                      } catch (err) {
                                        showDialog(
                                          err.message || "The document could not be deleted.",
                                          { title: "Document could not be deleted", severity: "error" }
                                        );
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

      <Card ref={readinessRef} sx={{ scrollMarginTop: 88 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Typography variant="h6">AI Readiness & Rejection Risk</Typography>

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={runAICheck}
                disabled={aiRunning || !canRunAI || claim.status === "SUBMITTED"}
              >
                Run AI Check
              </Button>

              <Button
                variant={claim.status === "SUBMITTED" ? "outlined" : "contained"}
                color={claim.status === "SUBMITTED" ? "inherit" : "success"}
                onClick={submitClaim}
                disabled={!canSubmit || submittingClaim || claim.status === "SUBMITTED"}
              >
                {claim.status === "SUBMITTED"
                  ? "Submitted"
                  : submittingClaim
                  ? "Submitting..."
                  : "Submit Claim"}
              </Button>
            </Stack>
          </Stack>

          {claim.status !== "SUBMITTED" && (!eligibilityClear || !priorAuthClear) && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Complete Claim Journey prerequisites before submission:
              {!eligibilityClear ? " eligibility verification" : ""}
              {!eligibilityClear && !priorAuthClear ? " and" : ""}
              {!priorAuthClear ? " prior authorization" : ""}.
            </Alert>
          )}

          {claim.status === "SUBMITTED" && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Claim submitted{claim.claimSubmissionDate ? ` on ${formatDate(claim.claimSubmissionDate)}` : ""}. Claim data and documents are locked.
            </Alert>
          )}

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

              <Alert severity="info" sx={{ mb: 2 }}>
                Readiness is based on the current automated checks for policy number, ICD-10 coding,
                supporting documents, and billed-versus-claimed amount. TPA is informational in the
                current rule set and does not reduce the score.
              </Alert>

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
                <Stack spacing={1.25} sx={{ mt: 2 }}>
                  <Typography variant="subtitle2">
                    Action required to improve this claim
                  </Typography>
                  {check.issues.map((issue, idx) => (
                    <Paper
                      key={idx}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderColor:
                          issue.severity === "BLOCK"
                            ? "error.light"
                            : "warning.light"
                      }}
                    >
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        alignItems={{ xs: "stretch", sm: "center" }}
                        justifyContent="space-between"
                        spacing={1.5}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            label={issue.severity}
                            color={
                              issue.severity === "BLOCK"
                                ? "error"
                                : "warning"
                            }
                          />
                          <Typography variant="body2" fontWeight={600}>
                            {issue.message}
                          </Typography>
                        </Stack>
                        <Button
                          size="small"
                          variant="contained"
                          color={issue.severity === "BLOCK" ? "error" : "warning"}
                          startIcon={<BuildCircle />}
                          onClick={() => fixIssue(issue)}
                          disabled={claim.status === "SUBMITTED"}
                          sx={{ flexShrink: 0 }}
                        >
                          {fixButtonLabel(issue)}
                        </Button>
                      </Stack>
                    </Paper>
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