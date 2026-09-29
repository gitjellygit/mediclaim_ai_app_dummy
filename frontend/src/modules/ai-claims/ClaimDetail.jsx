import React from "react";
import {
  Box, Card, CardContent, Typography, Button, Chip, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TablePagination,
  LinearProgress, Divider, TextField, Paper, Checkbox, IconButton, Tooltip,
  Collapse, Alert, Snackbar, MenuItem
} from "@mui/material";
import {
  DeleteForever, ExpandMore, ExpandLess, Visibility, Download, 
  SelectAll, CheckBox, CheckBoxOutlineBlank, DeleteSweep, FolderOpen, BuildCircle,
  AutoAwesome, Person, Calculate, FactCheck
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

function readinessColor(score) {
  const value = Number(score || 0);
  if (value < 40) return "error";
  if (value < 70) return "warning";
  return "success";
}

function readinessTextColor(score) {
  const value = Number(score || 0);
  if (value < 40) return "error.main";
  if (value < 70) return "warning.dark";
  return "success.main";
}


function provenanceChipColor(source) {
  if (source === "DOCUMENT_AI") return "secondary";
  if (source === "CALCULATED_ESTIMATE") return "warning";
  if (source === "LOCAL_PRECHECK" || source === "DERIVED") return "info";
  if (source === "USER" || source === "USER_RECORDED") return "default";
  return "default";
}

function SourceBadge({ claim, field }) {
  const source = claim?.fieldProvenance?.[field];
  if (!source) return null;

  const confidence =
    source.confidence != null ? ` • ${source.confidence}%` : "";

  return (
    <Tooltip
      title={
        [source.sourceDetail, source.updatedAt
          ? `Updated ${new Date(source.updatedAt).toLocaleString()}`
          : null]
          .filter(Boolean)
          .join(" • ")
      }
    >
      <Chip
        size="small"
        variant="outlined"
        color={provenanceChipColor(source.source)}
        label={`${source.label || source.source}${confidence}`}
        sx={{ ml: 0.75, height: 22, fontSize: "0.68rem" }}
      />
    </Tooltip>
  );
}

function FieldLine({ claim, field, label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="div">
        <b>{label}:</b> {children}
      </Typography>
      <SourceBadge claim={claim} field={field} />
    </Box>
  );
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
  const [docType, setDocType] = React.useState("AUTO");
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
  const [automationExpanded, setAutomationExpanded] = React.useState(false);
  const [automationFilter, setAutomationFilter] = React.useState("all");
  const [completenessExpanded, setCompletenessExpanded] = React.useState(false);
  const [completenessFilter, setCompletenessFilter] = React.useState("all");
  const patientPolicyRef = React.useRef(null);
  const documentsRef = React.useRef(null);
  const readinessRef = React.useRef(null);

  async function load({ silent = false } = {}) {
    if (!id) {
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);

    try {
      const data = await ClaimsApi.get(id);
      setClaim(data);
      return data;
    } catch (e) {
      if (!silent) setClaim(null);
      throw e;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [id]);

  // Keep Claim Detail synchronized with updates performed on Claim Journey.
  // Browser back/forward and tab focus can return to an already-mounted page,
  // so refresh silently instead of showing stale eligibility/auth values.
  React.useEffect(() => {
    if (!id) return;

    const refresh = () => {
      load({ silent: true }).catch(() => {});
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [id]);

  React.useEffect(() => {
    if (!id) return;
    load({ silent: true }).catch(() => {});
  }, [location.key]);

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
      dateOfService: claim.dateOfService
        ? new Date(claim.dateOfService).toISOString().slice(0, 10)
        : "",
      admissionDate: claim.admissionDate
        ? new Date(claim.admissionDate).toISOString().slice(0, 10)
        : "",
      dischargeDate: claim.dischargeDate
        ? new Date(claim.dischargeDate).toISOString().slice(0, 10)
        : "",
      admissionType: claim.admissionType || "",
      roomCategory: claim.roomCategory || "",
      icuDays: claim.icuDays != null ? String(claim.icuDays) : "",
      procedureText: claim.procedureText || "",
      procedureDate: claim.procedureDate
        ? new Date(claim.procedureDate).toISOString().slice(0, 10)
        : "",
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
      dateOfService: claim.dateOfService
        ? new Date(claim.dateOfService).toISOString().slice(0, 10)
        : "",
      admissionDate: claim.admissionDate
        ? new Date(claim.admissionDate).toISOString().slice(0, 10)
        : "",
      dischargeDate: claim.dischargeDate
        ? new Date(claim.dischargeDate).toISOString().slice(0, 10)
        : "",
      admissionType: claim.admissionType || "",
      roomCategory: claim.roomCategory || "",
      icuDays: claim.icuDays != null ? String(claim.icuDays) : "",
      procedureText: claim.procedureText || "",
      procedureDate: claim.procedureDate
        ? new Date(claim.procedureDate).toISOString().slice(0, 10)
        : "",
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
      dateOfService: editForm.dateOfService || null,
      admissionDate: editForm.admissionDate || null,
      dischargeDate: editForm.dischargeDate || null,
      admissionType: editForm.admissionType || null,
      roomCategory: editForm.roomCategory || null,
      icuDays:
        editForm.icuDays !== "" && editForm.icuDays != null
          ? Number(editForm.icuDays)
          : null,
      procedureText: editForm.procedureText || null,
      procedureDate: editForm.procedureDate || null,
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

    if (message.includes("date of service")) {
      openClaimEdit("dateOfService");
      return;
    }

    if (message.includes("admission date")) {
      openClaimEdit("admissionDate");
      return;
    }

    if (message.includes("discharge date")) {
      openClaimEdit("dischargeDate");
      return;
    }

    if (message.includes("admission type")) {
      openClaimEdit("admissionType");
      return;
    }

    if (message.includes("room category")) {
      openClaimEdit("roomCategory");
      return;
    }

    if (message.includes("icu days")) {
      openClaimEdit("icuDays");
      return;
    }

    openClaimEdit("claim");
  }

  function isIssueResolvedByCurrentClaim(issue) {
    const message = String(issue?.message || "").toLowerCase();

    if (message.includes("eligibility")) {
      return claim?.eligibilityStatus === "VERIFIED";
    }

    if (message.includes("prior authorization")) {
      return ["APPROVED", "NOT_REQUIRED"].includes(claim?.priorAuthStatus);
    }

    if (message.includes("supporting document")) {
      return Array.isArray(claim?.documents) && claim.documents.length > 0;
    }

    if (message.includes("policy")) {
      return Boolean(claim?.policyNo);
    }

    if (message.includes("icd")) {
      return Array.isArray(claim?.icd10Codes) && claim.icd10Codes.length > 0;
    }

    if (message.includes("amount")) {
      return Number(claim?.amount || claim?.totalBilledAmount || 0) > 0;
    }

    return false;
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

  function showAutomationBucket(bucket) {
    setAutomationFilter(bucket);
    setAutomationExpanded(true);
  }

  function automationFieldAction(item) {
    if (!item) return;

    const claimEditFields = new Set([
      "patientName",
      "patientDob",
      "memberId",
      "payerName",
      "policyNo",
      "hospitalName",
      "doctorName",
      "diagnosisText",
      "icd10Codes",
      "dateOfService",
      "amount",
      "totalBilledAmount"
    ]);

    const eligibilityFields = new Set([
      "eligibilityStatus",
      "coverageStatus",
      "deductibleRemaining",
      "coinsurancePct",
      "networkStatus"
    ]);

    const priorAuthFields = new Set([
      "priorAuthRequired",
      "priorAuthStatus",
      "priorAuthExpiry",
      "authorizationNo"
    ]);

    const payerStatusFields = new Set(["payerClaimStatus"]);

    const remittanceFields = new Set([
      "allowedAmount",
      "paidAmount",
      "patientResponsibility",
      "paymentReference",
      "approvedAmount"
    ]);

    if (claimEditFields.has(item.field)) {
      openClaimEdit(item.field);
      return;
    }

    if (
      eligibilityFields.has(item.field) ||
      priorAuthFields.has(item.field) ||
      payerStatusFields.has(item.field) ||
      remittanceFields.has(item.field)
    ) {
      const stage =
        eligibilityFields.has(item.field)
          ? "eligibility"
          : priorAuthFields.has(item.field)
          ? "prior-auth"
          : payerStatusFields.has(item.field)
          ? "claim-status"
          : "remittance";

      navigate(`/journey?claimId=${claim.id}&stage=${stage}`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }

    showDialog(
      `${item.label} is currently tracked by the automation engine, but there is no direct edit action for this field yet.`,
      {
        title: item.bucket === "missing" ? "Missing field" : "Field review",
        severity: "info"
      }
    );
  }

  function automationActionLabel(item) {
    if (!item || item.bucket === "automated") return "View";

    const journeyFields = new Set([
      "eligibilityStatus",
      "coverageStatus",
      "deductibleRemaining",
      "coinsurancePct",
      "networkStatus",
      "priorAuthRequired",
      "priorAuthStatus",
      "priorAuthExpiry",
      "authorizationNo",
      "payerClaimStatus",
      "allowedAmount",
      "paidAmount",
      "patientResponsibility",
      "paymentReference",
      "approvedAmount"
    ]);

    if (journeyFields.has(item.field)) return "Open Journey";
    return item.bucket === "missing" ? "Add / Fix" : "Review / Fix";
  }

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
      await load({ silent: true });
      window.setTimeout(() => {
        readinessRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 120);
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
      const result = await ClaimsApi.applyDocumentSuggestion(doc.id);
      if (!result?.unchanged) {
        showToast(
          result?.message || "AI document type applied",
          "success"
        );
      }
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
  const previousCheck = claim.checks?.[1] || null;
  const checkHistory = Array.isArray(claim.checks) ? claim.checks.slice(0, 5) : [];
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const liveResolvedIssues = check?.isStale
    ? issues.filter((issue) => isIssueResolvedByCurrentClaim(issue))
    : [];
  const unresolvedDisplayedIssues = check?.isStale
    ? issues.filter((issue) => !isIssueResolvedByCurrentClaim(issue))
    : [];
  const hasBlock = issues.some((i) => i.severity === "BLOCK");
  const eligibilityClear = claim.eligibilityStatus === "VERIFIED";
  const priorAuthClear =
    claim.priorAuthStatus === "APPROVED" ||
    claim.priorAuthStatus === "NOT_REQUIRED";

  const completeness = claim.completenessSummary;
  const completenessByField = React.useMemo(() => {
    return Object.fromEntries(
      (completeness?.fields || []).map((item) => [item.field, item])
    );
  }, [completeness]);

  function completenessValue(field, value, formatter = (v) => v) {
    const state = completenessByField[field]?.state;
    if (state === "not_applicable") return "N/A";
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return state === "missing" ? "Missing" : state === "review" ? "Needs Review" : "—";
    }
    return formatter(value);
  }

  function openCompletenessBucket(bucket) {
    setCompletenessFilter(bucket);
    setCompletenessExpanded(true);
  }

  function fixCompletenessItem(item) {
    if (!item) return;
    if (["eligibility", "prior-auth"].includes(item.fixTarget)) {
      navigate(`/journey?claimId=${claim.id}&stage=${item.fixTarget}`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }
    openClaimEdit(item.field);
  }

  const canSubmit =
    claim.status !== "SUBMITTED" &&
    eligibilityClear &&
    priorAuthClear &&
    !!check &&
    !check.isStale &&
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

      {claim.automationSummary && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              spacing={2}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <AutoAwesome color="secondary" />
                  <Typography variant="h6" fontWeight={700}>
                    Claim Automation
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Shows what the system populated automatically, what staff entered,
                  and what still needs review.
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  icon={<AutoAwesome />}
                  color="success"
                  clickable
                  onClick={() => showAutomationBucket("automated")}
                  label={`${claim.automationSummary.automatedFields} auto-populated`}
                  sx={{ cursor: "pointer" }}
                />
                <Chip
                  icon={<FactCheck />}
                  color="warning"
                  clickable
                  onClick={() => showAutomationBucket("review")}
                  label={`${claim.automationSummary.reviewFields} need review`}
                  sx={{ cursor: "pointer" }}
                />
                <Chip
                  icon={<Person />}
                  variant="outlined"
                  clickable
                  onClick={() => showAutomationBucket("manual")}
                  label={`${claim.automationSummary.manualFields} manual`}
                  sx={{ cursor: "pointer" }}
                />
                <Chip
                  icon={<Calculate />}
                  color={claim.automationSummary.missingFields ? "error" : "default"}
                  variant={claim.automationSummary.missingFields ? "filled" : "outlined"}
                  clickable
                  onClick={() => showAutomationBucket("missing")}
                  label={`${claim.automationSummary.missingFields} missing`}
                  sx={{ cursor: "pointer" }}
                />
              </Stack>
            </Stack>

            <Box sx={{ mt: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" fontWeight={600}>
                  Automation rate: {claim.automationSummary.automationRate}%
                  {" "}of currently populated tracked fields
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    setAutomationFilter("all");
                    setAutomationExpanded((value) => !value);
                  }}
                >
                  {automationExpanded ? "Hide Field Sources" : "View Field Sources"}
                </Button>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={claim.automationSummary.automationRate}
                color={
                  claim.automationSummary.automationRate >= 70
                    ? "success"
                    : claim.automationSummary.automationRate >= 40
                    ? "warning"
                    : "primary"
                }
                sx={{ mt: 1, height: 8, borderRadius: 4 }}
              />
            </Box>

            <Collapse in={automationExpanded}>
              <Divider sx={{ my: 2 }} />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={1}
                sx={{ mb: 1.5 }}
              >
                <Typography variant="subtitle2" fontWeight={700}>
                  {automationFilter === "missing"
                    ? "Missing fields — click a field to complete it"
                    : automationFilter === "review"
                    ? "Fields needing review — click a field to resolve it"
                    : automationFilter === "manual"
                    ? "Manually entered fields"
                    : automationFilter === "automated"
                    ? "Auto-populated fields and their sources"
                    : "All tracked fields"}
                </Typography>
                {automationFilter !== "all" && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setAutomationFilter("all")}
                  >
                    Show all fields
                  </Button>
                )}
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(3, minmax(0, 1fr))"
                  },
                  gap: 1
                }}
              >
                {claim.automationSummary.fields
                  .filter(
                    (item) =>
                      automationFilter === "all" ||
                      item.bucket === automationFilter
                  )
                  .map((item) => (
                  <Paper
                    key={item.field}
                    variant="outlined"
                    onClick={() =>
                      ["missing", "review"].includes(item.bucket)
                        ? automationFieldAction(item)
                        : undefined
                    }
                    sx={{
                      p: 1.25,
                      cursor: ["missing", "review"].includes(item.bucket)
                        ? "pointer"
                        : "default",
                      transition: "all 0.15s ease",
                      "&:hover": ["missing", "review"].includes(item.bucket)
                        ? {
                            borderColor:
                              item.bucket === "missing"
                                ? "error.main"
                                : "warning.main",
                            boxShadow: 2,
                            transform: "translateY(-1px)"
                          }
                        : undefined
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      spacing={1}
                    >
                      <Typography variant="body2" fontWeight={600}>
                        {item.label}
                      </Typography>
                      {["missing", "review"].includes(item.bucket) && (
                        <Button
                          size="small"
                          variant="text"
                          color={item.bucket === "missing" ? "error" : "warning"}
                          onClick={(event) => {
                            event.stopPropagation();
                            automationFieldAction(item);
                          }}
                        >
                          {automationActionLabel(item)}
                        </Button>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap">
                      <Chip
                        size="small"
                        label={
                          item.bucket === "automated"
                            ? "Auto-populated"
                            : item.bucket === "manual"
                            ? "Manual"
                            : item.bucket === "review"
                            ? "Needs Review"
                            : "Missing"
                        }
                        color={
                          item.bucket === "automated"
                            ? "success"
                            : item.bucket === "review"
                            ? "warning"
                            : item.bucket === "missing"
                            ? "error"
                            : "default"
                        }
                        variant={item.bucket === "manual" ? "outlined" : "filled"}
                      />
                      {item.source && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={provenanceChipColor(item.source.source)}
                          label={
                            item.source.confidence != null
                              ? `${item.source.label} • ${item.source.confidence}%`
                              : item.source.label
                          }
                        />
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Collapse>
          </CardContent>
        </Card>
      )}

      {completeness && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              spacing={2}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Claim Completeness
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Context-aware: only fields applicable to this encounter count against completeness.
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  color={completeness.score >= 90 ? "success" : completeness.score >= 70 ? "warning" : "error"}
                  label={`${completeness.score}% complete`}
                />
                <Chip
                  clickable
                  color={completeness.missingFields ? "error" : "default"}
                  onClick={() => openCompletenessBucket("missing")}
                  label={`${completeness.missingFields} missing`}
                />
                <Chip
                  clickable
                  color={completeness.reviewFields ? "warning" : "default"}
                  onClick={() => openCompletenessBucket("review")}
                  label={`${completeness.reviewFields} need review`}
                />
                <Chip
                  clickable
                  variant="outlined"
                  onClick={() => openCompletenessBucket("not_applicable")}
                  label={`${completeness.notApplicableFields} N/A`}
                />
              </Stack>
            </Stack>

            <LinearProgress
              variant="determinate"
              value={completeness.score}
              color={completeness.score >= 90 ? "success" : completeness.score >= 70 ? "warning" : "error"}
              sx={{ mt: 2, height: 8, borderRadius: 4 }}
            />

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {completeness.completeFields} of {completeness.applicableFields} applicable fields complete
              </Typography>
              <Button
                size="small"
                onClick={() => {
                  setCompletenessFilter("all");
                  setCompletenessExpanded((value) => !value);
                }}
              >
                {completenessExpanded ? "Hide Details" : "View Details"}
              </Button>
            </Stack>

            <Collapse in={completenessExpanded}>
              <Divider sx={{ my: 2 }} />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={1}
                sx={{ mb: 1.5 }}
              >
                <Typography variant="subtitle2" fontWeight={700}>
                  {completenessFilter === "missing"
                    ? "Missing required fields"
                    : completenessFilter === "review"
                    ? "Applicable fields needing review"
                    : completenessFilter === "not_applicable"
                    ? "Fields not applicable to this encounter"
                    : "All completeness fields"}
                </Typography>
                {completenessFilter !== "all" && (
                  <Button size="small" onClick={() => setCompletenessFilter("all")}>
                    Show all
                  </Button>
                )}
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(3, minmax(0, 1fr))"
                  },
                  gap: 1
                }}
              >
                {completeness.fields
                  .filter(
                    (item) =>
                      completenessFilter === "all" ||
                      item.state === completenessFilter
                  )
                  .map((item) => (
                    <Paper
                      key={item.field}
                      variant="outlined"
                      sx={{
                        p: 1.25,
                        borderColor:
                          item.state === "missing"
                            ? "error.light"
                            : item.state === "review"
                            ? "warning.light"
                            : undefined
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography variant="body2" fontWeight={700}>
                            {item.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.reason || (item.conditional ? "Conditional" : "Applicable")}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          color={
                            item.state === "complete"
                              ? "success"
                              : item.state === "missing"
                              ? "error"
                              : item.state === "review"
                              ? "warning"
                              : "info"
                          }
                          variant={item.state === "not_applicable" ? "outlined" : "filled"}
                          label={
                            item.state === "complete"
                              ? "Complete"
                              : item.state === "missing"
                              ? "Missing"
                              : item.state === "review"
                              ? "Review"
                              : "N/A"
                          }
                        />
                      </Stack>
                      {["missing", "review"].includes(item.state) && (
                        <Button
                          size="small"
                          sx={{ mt: 1 }}
                          onClick={() => fixCompletenessItem(item)}
                        >
                          Fix
                        </Button>
                      )}
                    </Paper>
                  ))}
              </Box>
            </Collapse>
          </CardContent>
        </Card>
      )}

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
                  <FieldLine claim={claim} field="diagnosisText" label="Diagnosis">{claim.diagnosisText || "—"}</FieldLine>
                  <FieldLine claim={claim} field="icd10Codes" label="ICD-10">{claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "—"}</FieldLine>
                  <FieldLine claim={claim} field="doctorName" label="Doctor">{claim.doctorName || "—"}</FieldLine>
                  <FieldLine claim={claim} field="hospitalName" label="Hospital">{claim.hospitalName || "—"}</FieldLine>
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Patient identity & coverage
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <FieldLine claim={claim} field="memberId" label="Member ID">{claim.memberId || "—"}</FieldLine>
                  <FieldLine claim={claim} field="patientDob" label="DOB">{formatDate(claim.patientDob)}</FieldLine>
                  <FieldLine claim={claim} field="policyNo" label="Policy No">{claim.policyNo || "—"}</FieldLine>
                  <FieldLine claim={claim} field="payerName" label="Payer">{claim.payerName || "—"}</FieldLine>
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
                  <FieldLine claim={claim} field="dateOfService" label="Date of Service">{completenessValue("dateOfService", claim.dateOfService, formatDate)}</FieldLine>
                  <Typography><b>Admission:</b> {completenessValue("admissionDate", claim.admissionDate, formatDate)}</Typography>
                  <Typography><b>Discharge:</b> {completenessValue("dischargeDate", claim.dischargeDate, formatDate)}</Typography>
                  <Typography><b>Admission Type:</b> {completenessValue("admissionType", claim.admissionType)}</Typography>
                  <Typography><b>Room Category:</b> {completenessValue("roomCategory", claim.roomCategory)}</Typography>
                  <Typography><b>ICU Days:</b> {completenessValue("icuDays", claim.icuDays)}</Typography>
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Claim & financials
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <FieldLine claim={claim} field="totalBilledAmount" label="Total Billed">{formatMoney(claim.totalBilledAmount)}</FieldLine>
                  <FieldLine claim={claim} field="amount" label="Claimed Amount">{formatMoney(claim.amount)}</FieldLine>
                  <FieldLine claim={claim} field="approvedAmount" label="Approved Amount">{formatMoney(claim.approvedAmount)}</FieldLine>
                  <Typography><b>Insurer Claim No:</b> {claim.insurerClaimNo || "—"}</Typography>
                  <FieldLine claim={claim} field="authorizationNo" label="Authorization No">{claim.authorizationNo || "—"}</FieldLine>
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
              <Divider />
              <Typography variant="subtitle2">Encounter Details</Typography>
              <TextField
                label="Date of Service"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.dateOfService}
                onChange={(e) => updateEditField("dateOfService", e.target.value)}
                color={fixFocus === "dateOfService" ? "warning" : "primary"}
                focused={fixFocus === "dateOfService"}
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Admission Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={editForm.admissionDate}
                  onChange={(e) => updateEditField("admissionDate", e.target.value)}
                  color={fixFocus === "admissionDate" ? "warning" : "primary"}
                  focused={fixFocus === "admissionDate"}
                  fullWidth
                />
                <TextField
                  label="Discharge Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={editForm.dischargeDate}
                  onChange={(e) => updateEditField("dischargeDate", e.target.value)}
                  color={fixFocus === "dischargeDate" ? "warning" : "primary"}
                  focused={fixFocus === "dischargeDate"}
                  fullWidth
                />
              </Stack>
              <TextField
                select
                label="Admission Type"
                value={editForm.admissionType}
                onChange={(e) => updateEditField("admissionType", e.target.value)}
                color={fixFocus === "admissionType" ? "warning" : "primary"}
                focused={fixFocus === "admissionType"}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="PLANNED">Planned</MenuItem>
                <MenuItem value="EMERGENCY">Emergency</MenuItem>
              </TextField>
              <TextField
                select
                label="Room Category"
                value={editForm.roomCategory}
                onChange={(e) => updateEditField("roomCategory", e.target.value)}
                color={fixFocus === "roomCategory" ? "warning" : "primary"}
                focused={fixFocus === "roomCategory"}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="GENERAL">General</MenuItem>
                <MenuItem value="SEMI_PRIVATE">Semi Private</MenuItem>
                <MenuItem value="PRIVATE">Private</MenuItem>
                <MenuItem value="ICU">ICU</MenuItem>
              </TextField>
              <TextField
                label="ICU Days"
                type="number"
                inputProps={{ min: 0 }}
                value={editForm.icuDays}
                onChange={(e) => updateEditField("icuDays", e.target.value)}
                color={fixFocus === "icuDays" ? "warning" : "primary"}
                focused={fixFocus === "icuDays"}
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
              helperText={
                docType === "AUTO"
                  ? "Recommended: AI detects the document type automatically"
                  : "Manual override selected; AI will still validate the document type"
              }
            >
              <MenuItem
                value="AUTO"
                sx={{ cursor: "pointer", py: 1.1, fontWeight: 700 }}
              >
                Auto Detect with AI (Recommended)
              </MenuItem>
              <Divider />
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
                      type: docType === "AUTO" ? null : docType,
                      file
                    });

                    const selectedType =
                      docType === "AUTO" ? null : docType;
                    const suggestedType =
                      result?.suggestedType || result?.document?.suggestedType;
                    const suggestionConfidence =
                      result?.confidence ?? result?.document?.confidence;

                    if (
                      selectedType &&
                      suggestedType &&
                      selectedType !== suggestedType
                    ) {
                      showDialog(
                        `You selected ${DOC_TYPE_LABELS[selectedType] || selectedType}, but AI detected ${DOC_TYPE_LABELS[suggestedType] || suggestedType}${suggestionConfidence != null ? ` with ${suggestionConfidence}% confidence` : ""}. The document was uploaded using your selected type. You can use the AI suggestion from the Documents table after review.`,
                        {
                          title: "Document type needs review",
                          severity: "warning"
                        }
                      );
                    } else if (result?.identityValidation?.status === "UNVERIFIED") {
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
                                  label={DOC_TYPE_LABELS[doc.suggestedType] || doc.suggestedType.replaceAll("_", " ")}
                                />
                                {doc.suggestedType !== doc.type && canDeleteDoc && (
                                  <Tooltip title="Change the saved document type to the AI-detected type">
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      onClick={() => applyDocSuggestion(doc)}
                                      sx={{ fontSize: "0.7rem", py: 0.25, px: 1, cursor: "pointer" }}
                                    >
                                      Use AI Type
                                    </Button>
                                  </Tooltip>
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
                {check?.isStale ? "Refresh AI Readiness" : check ? "Run AI Check Again" : "Run AI Check"}
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
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
                sx={{ mt: 2 }}
              >
                <Box>
                  <Typography variant="subtitle1" fontWeight={700}>
                    Last AI Readiness
                  </Typography>
                  <Typography
                    variant="h4"
                    fontWeight={800}
                    sx={{ color: readinessTextColor(check.score) }}
                  >
                    {check.score}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Checked {new Date(check.createdAt).toLocaleString()}
                  </Typography>
                </Box>

                {check.comparison?.scoreDelta != null && (
                  <Chip
                    color={
                      check.comparison.scoreDelta > 0
                        ? "success"
                        : check.comparison.scoreDelta < 0
                        ? "error"
                        : "default"
                    }
                    label={
                      check.comparison.scoreDelta > 0
                        ? `+${check.comparison.scoreDelta}% since previous check`
                        : check.comparison.scoreDelta < 0
                        ? `${check.comparison.scoreDelta}% since previous check`
                        : "No score change"
                    }
                  />
                )}
              </Stack>

              <LinearProgress
                variant="determinate"
                value={check.score}
                color={readinessColor(check.score)}
                sx={{ height: 12, borderRadius: 6, my: 2 }}
              />

              {check.isStale ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <b>Claim changed after this AI Check.</b>{" "}
                  {check.staleReason || "Claim information was updated"}.
                  {liveResolvedIssues.length > 0
                    ? ` ${liveResolvedIssues.length} previous issue(s) now appear resolved from the latest claim data.`
                    : ""}
                  {" "}Refresh AI readiness to recalculate the score before submission.
                </Alert>
              ) : (
                <Alert severity={readinessColor(check.score)} sx={{ mb: 2 }}>
                  {check.score >= 80 && !hasBlock
                    ? "This readiness check is current and meets the submission threshold."
                    : "This readiness check is current. Resolve the remaining issues and run AI Check again."}
                </Alert>
              )}

              {check.comparison && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ mb: 2, flexWrap: "wrap" }}
                >
                  {check.comparison.resolvedIssues?.length > 0 && (
                    <Chip
                      size="small"
                      color="success"
                      label={`${check.comparison.resolvedIssues.length} issue(s) resolved`}
                    />
                  )}
                  {check.comparison.newIssues?.length > 0 && (
                    <Chip
                      size="small"
                      color="error"
                      label={`${check.comparison.newIssues.length} new issue(s)`}
                    />
                  )}
                  {check.isStale && liveResolvedIssues.length > 0 && (
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={`${liveResolvedIssues.length} resolved since this check`}
                    />
                  )}
                </Stack>
              )}

              <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
                <Tooltip title="Rule-based estimate derived from the same readiness gaps and claim-risk checks. It is not a payer probability.">
                  <Chip
                    label={`Estimated Rejection Risk: ${pct(check.riskScore)} (${check.riskLevel || "—"})`}
                    color={riskChipColor(check.riskLevel)}
                  />
                </Tooltip>

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

              {issues.length === 0 ? (
                <Chip label="Claim is ready for submission" color="success" sx={{ mt: 2 }} />
              ) : (
                <Stack spacing={1.25} sx={{ mt: 2 }}>
                  {check.isStale && liveResolvedIssues.length > 0 && (
                    <>
                      <Typography variant="subtitle2" color="success.main">
                        Resolved since the last AI Check
                      </Typography>
                      {liveResolvedIssues.map((issue, idx) => (
                        <Paper
                          key={`resolved-${idx}`}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderColor: "success.light",
                            backgroundColor: "rgba(46,125,50,0.04)"
                          }}
                        >
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            alignItems={{ xs: "stretch", sm: "center" }}
                            justifyContent="space-between"
                            spacing={1}
                          >
                            <Typography variant="body2" fontWeight={600}>
                              {issue.message}
                            </Typography>
                            <Chip size="small" color="success" label="Resolved — refresh AI" />
                          </Stack>
                        </Paper>
                      ))}
                    </>
                  )}

                  {unresolvedDisplayedIssues.length > 0 && (
                    <Typography variant="subtitle2">
                      Action required to improve this claim
                    </Typography>
                  )}

                  {unresolvedDisplayedIssues.map((issue, idx) => (
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

              {checkHistory.length > 1 && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    AI Readiness History
                  </Typography>
                  <Stack spacing={0.75}>
                    {checkHistory.map((item, index) => (
                      <Paper
                        key={item.id}
                        variant="outlined"
                        sx={{
                          p: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 1,
                          flexWrap: "wrap"
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            color={readinessColor(item.score)}
                            label={`${item.score}%`}
                          />
                          <Typography variant="body2">
                            {new Date(item.createdAt).toLocaleString()}
                          </Typography>
                          {item.isStale && (
                            <Chip size="small" variant="outlined" color="warning" label="Out of date" />
                          )}
                          {index === 0 && !item.isStale && (
                            <Chip size="small" variant="outlined" color="success" label="Current" />
                          )}
                        </Stack>
                        {item.comparison?.scoreDelta != null && (
                          <Typography
                            variant="caption"
                            color={
                              item.comparison.scoreDelta > 0
                                ? "success.main"
                                : item.comparison.scoreDelta < 0
                                ? "error.main"
                                : "text.secondary"
                            }
                          >
                            {item.comparison.scoreDelta > 0 ? "+" : ""}
                            {item.comparison.scoreDelta}% vs previous
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                </Box>
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