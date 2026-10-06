import React from "react";
import {
  Box, Card, CardContent, Typography, Button, Chip, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TablePagination,
  LinearProgress, Divider, TextField, Paper, Checkbox, IconButton, Tooltip,
  Collapse, Alert, Snackbar, MenuItem, Autocomplete
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
import ClaimSummaryCard from "./claim-detail/ClaimSummaryCard.jsx";
import ClaimCompletenessCard from "./claim-detail/ClaimCompletenessCard.jsx";
import { useClaimDetailData } from "./claim-detail/useClaimDetailData.js";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  formatDate,
  formatMoney,
  readinessTextColor,
  provenanceChipColor
} from "./claim-detail/claimDetailUtils.js";
import ServiceLinesEditor, { emptyServiceLine, serviceLineToForm, serviceLineToPayload } from "../../components/ServiceLinesEditor.jsx";
import { formatUSDateOnly, toDateInputValue } from "../../utils/dateOnly.js";
import {
  TYPE_OF_BILL_BASE_OPTIONS,
  drgError,
  icd10CmError,
  icd10PcsError,
  normalizeIcd10Cm,
  normalizeIcd10Pcs,
  normalizeNpi,
  normalizeTaxonomy,
  normalizeTin,
  npiError,
  taxonomyError,
  tinError,
  typeOfBillError,
  typeOfBillFor
} from "../../utils/usClaimValidation.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

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
  const { claim, setClaim, loading, load } = useClaimDetailData(id, location.key);

  const { showToast, showDialog, confirmDialog } = useToast();
  const user = AuthApi.getUser();
  const isAdmin = user?.role === "ADMIN";
  const canRunAI = user?.role === "ADMIN" || user?.role === "CASHIER";
  const canDeleteDoc = user?.role === "ADMIN" || user?.role === "CASHIER";
  const aiCheckLocked =
    ["SUBMITTED", "DENIED", "PAID"].includes(claim?.status) ||
    Boolean(claim?.claimSubmissionDate);
  const canEditClaim = !!user;

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
  const [fixFields, setFixFields] = React.useState([]);
  const [readinessHistoryExpanded, setReadinessHistoryExpanded] = React.useState(false);
  const patientPolicyRef = React.useRef(null);
  const documentsRef = React.useRef(null);
  const readinessRef = React.useRef(null);

  React.useEffect(() => {
    if (!claim) return;
    setEditForm({
      claimForm: claim.claimForm || "",
      patientName: claim.patientName || "",
      payerName: claim.payerName || "",
      policyNo: claim.policyNo || "",
      memberId: claim.memberId || "",
      medicalRecordNumber: claim.medicalRecordNumber || "",
      planAdministratorName: claim.planAdministratorName || "",
      groupNumber: claim.groupNumber || "",
      subscriberId: claim.subscriberId || "",
      subscriberName: claim.subscriberName || "",
      subscriberRelationship: claim.subscriberRelationship || "",
      coordinationOfBenefits: claim.coordinationOfBenefits || "",
      payerEdiId: claim.payerEdiId || "",
      coverageLimit: claim.coverageLimit != null ? String(claim.coverageLimit) : "",
      remainingCoverageLimit:
        claim.remainingCoverageLimit != null ? String(claim.remainingCoverageLimit) : "",
      payerReferenceNo: claim.payerReferenceNo || "",
      patientDob: toDateInputValue(claim.patientDob),
      hospitalName: claim.hospitalName || "",
      billingProviderNpi: claim.billingProviderNpi || "",
      renderingProviderNpi: claim.renderingProviderNpi || "",
      referringProviderNpi: claim.referringProviderNpi || "",
      providerTin: claim.providerTin || "",
      providerTaxonomyCode: claim.providerTaxonomyCode || "",
      diagnosisText: claim.diagnosisText || "",
      icd10Codes: claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "",
      inpatientProcedureCodes: claim.inpatientProcedureCodes?.length
        ? claim.inpatientProcedureCodes.join(", ")
        : "",
      amount: claim.amount != null ? String(claim.amount) : "",
      totalBilledAmount: claim.totalBilledAmount != null ? String(claim.totalBilledAmount) : "",
      dateOfService: toDateInputValue(claim.dateOfService),
      admissionDate: toDateInputValue(claim.admissionDate),
      dischargeDate: toDateInputValue(claim.dischargeDate),
      admissionType: claim.admissionType || "",
      roomCategory: claim.roomCategory || "",
      icuDays: claim.icuDays != null ? String(claim.icuDays) : "",
      procedureText: claim.procedureText || "",
      procedureDate: toDateInputValue(claim.procedureDate),
      typeOfBill: claim.typeOfBill || "",
      drgCode: claim.drgCode || "",
      claimFrequencyCode: claim.claimFrequencyCode || "ORIGINAL",
      timelyFilingDeadline: toDateInputValue(claim.timelyFilingDeadline),
      serviceLines: (claim.serviceLines || []).map(serviceLineToForm),
      claimType: claim.claimType || "MEMBER_REIMBURSEMENT"
    });
  }, [claim]);

  function updateEditField(key, value) {
    setEditForm((f) => ({ ...(f || {}), [key]: value }));
  }

  function resetEditForm() {
    if (!claim) return;
    setEditForm({
      claimForm: claim.claimForm || "",
      patientName: claim.patientName || "",
      payerName: claim.payerName || "",
      policyNo: claim.policyNo || "",
      memberId: claim.memberId || "",
      medicalRecordNumber: claim.medicalRecordNumber || "",
      planAdministratorName: claim.planAdministratorName || "",
      groupNumber: claim.groupNumber || "",
      subscriberId: claim.subscriberId || "",
      subscriberName: claim.subscriberName || "",
      subscriberRelationship: claim.subscriberRelationship || "",
      coordinationOfBenefits: claim.coordinationOfBenefits || "",
      payerEdiId: claim.payerEdiId || "",
      coverageLimit: claim.coverageLimit != null ? String(claim.coverageLimit) : "",
      remainingCoverageLimit:
        claim.remainingCoverageLimit != null ? String(claim.remainingCoverageLimit) : "",
      payerReferenceNo: claim.payerReferenceNo || "",
      patientDob: toDateInputValue(claim.patientDob),
      hospitalName: claim.hospitalName || "",
      billingProviderNpi: claim.billingProviderNpi || "",
      renderingProviderNpi: claim.renderingProviderNpi || "",
      referringProviderNpi: claim.referringProviderNpi || "",
      providerTin: claim.providerTin || "",
      providerTaxonomyCode: claim.providerTaxonomyCode || "",
      diagnosisText: claim.diagnosisText || "",
      icd10Codes: claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "",
      inpatientProcedureCodes: claim.inpatientProcedureCodes?.length
        ? claim.inpatientProcedureCodes.join(", ")
        : "",
      amount: claim.amount != null ? String(claim.amount) : "",
      totalBilledAmount: claim.totalBilledAmount != null ? String(claim.totalBilledAmount) : "",
      dateOfService: toDateInputValue(claim.dateOfService),
      admissionDate: toDateInputValue(claim.admissionDate),
      dischargeDate: toDateInputValue(claim.dischargeDate),
      admissionType: claim.admissionType || "",
      roomCategory: claim.roomCategory || "",
      icuDays: claim.icuDays != null ? String(claim.icuDays) : "",
      procedureText: claim.procedureText || "",
      procedureDate: toDateInputValue(claim.procedureDate),
      typeOfBill: claim.typeOfBill || "",
      drgCode: claim.drgCode || "",
      claimFrequencyCode: claim.claimFrequencyCode || "ORIGINAL",
      timelyFilingDeadline: toDateInputValue(claim.timelyFilingDeadline),
      serviceLines: (claim.serviceLines || []).map(serviceLineToForm),
      claimType: claim.claimType || "MEMBER_REIMBURSEMENT"
    });
  }

  async function saveEdit() {
    if (!editForm) return;

    const validationErrors = [
      ["Billing Provider NPI", editForm.billingProviderNpi && npiError(editForm.billingProviderNpi)],
      ["Rendering Provider NPI", editForm.renderingProviderNpi && npiError(editForm.renderingProviderNpi)],
      ["Referring Provider NPI", editForm.referringProviderNpi && npiError(editForm.referringProviderNpi)],
      ["Provider TIN", editForm.providerTin && tinError(editForm.providerTin)],
      ["Provider Taxonomy Code", editForm.providerTaxonomyCode && taxonomyError(editForm.providerTaxonomyCode)],
      ["Type of Bill", editForm.typeOfBill && typeOfBillError(editForm.typeOfBill)],
      ["DRG", editForm.drgCode && drgError(editForm.drgCode)]
    ].filter(([, message]) => message);

    const invalidIcd = String(editForm.icd10Codes || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .find((value) => icd10CmError(value));
    if (invalidIcd) validationErrors.push(["ICD-10-CM", `${invalidIcd}: ${icd10CmError(invalidIcd)}`]);

    const invalidPcs = String(editForm.inpatientProcedureCodes || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .find((value) => icd10PcsError(value));
    if (invalidPcs) validationErrors.push(["ICD-10-PCS", `${invalidPcs}: ${icd10PcsError(invalidPcs)}`]);

    if (validationErrors.length) {
      const [field, message] = validationErrors[0];
      showDialog(message, { title: `Invalid ${field}`, severity: "warning" });
      return;
    }
    if (claim?.status === "SUBMITTED") {
      return showDialog(
        "Submitted claims are locked. Reopen or amend the claim before editing.",
        { title: "Claim is locked", severity: "warning" }
      );
    }

    const payload = {
      claimForm: editForm.claimForm || null,
      patientName: editForm.patientName?.trim(),
      payerName: editForm.payerName?.trim(),
      policyNo: editForm.policyNo || null,
      memberId: editForm.memberId || null,
      medicalRecordNumber: editForm.medicalRecordNumber || null,
      planAdministratorName: editForm.planAdministratorName || null,
      groupNumber: editForm.groupNumber || null,
      subscriberId: editForm.subscriberId || null,
      subscriberName: editForm.subscriberName || null,
      subscriberRelationship: editForm.subscriberRelationship || null,
      coordinationOfBenefits: editForm.coordinationOfBenefits || null,
      payerEdiId: editForm.payerEdiId || null,
      coverageLimit:
        editForm.coverageLimit !== "" ? Number(editForm.coverageLimit) : null,
      remainingCoverageLimit:
        editForm.remainingCoverageLimit !== ""
          ? Number(editForm.remainingCoverageLimit)
          : null,
      payerReferenceNo: editForm.payerReferenceNo || null,
      patientDob: editForm.patientDob || null,
      hospitalName: editForm.hospitalName || null,
      billingProviderNpi: editForm.billingProviderNpi ? normalizeNpi(editForm.billingProviderNpi) : null,
      renderingProviderNpi: editForm.renderingProviderNpi ? normalizeNpi(editForm.renderingProviderNpi) : null,
      referringProviderNpi: editForm.referringProviderNpi ? normalizeNpi(editForm.referringProviderNpi) : null,
      providerTin: editForm.providerTin ? normalizeTin(editForm.providerTin) : null,
      providerTaxonomyCode: editForm.providerTaxonomyCode ? normalizeTaxonomy(editForm.providerTaxonomyCode) : null,
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
        : [],
      inpatientProcedureCodes: editForm.inpatientProcedureCodes
        ? editForm.inpatientProcedureCodes.split(",").map((c) => c.trim()).filter(Boolean)
        : [],
      typeOfBill: editForm.typeOfBill || null,
      drgCode: editForm.drgCode || null,
      claimFrequencyCode: editForm.claimFrequencyCode || "ORIGINAL",
      timelyFilingDeadline: editForm.timelyFilingDeadline || null,
      serviceLines: (editForm.serviceLines || [])
        .filter((line) => line.cptHcpcsCode?.trim())
        .map(serviceLineToPayload)
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
      await load();
      setEditMode(false);
      setFixFocus("");
      setFixFields([]);
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

  function isFixField(field) {
    return fixFocus === field || fixFields.includes(field);
  }

  function openClaimEdit(focus = "claim", fields = [focus]) {
    if (["SUBMITTED", "DENIED", "PAID"].includes(claim?.status)) {
      showDialog(
        "This claim is locked after submission. This data gap is informational unless the claim is reopened or amended.",
        { title: "Claim is locked", severity: "info" }
      );
      return;
    }

    setFixFocus(focus);
    setFixFields(Array.isArray(fields) ? fields.filter(Boolean) : [focus]);
    setEditMode(true);
    scrollToRef(patientPolicyRef);
  }

  function fixIssue(issue) {
    const message = String(issue?.message || "").toLowerCase();

    if (issue?.fixTarget === "documents") {
      setFixFocus("documents");
      setFixFields(["documents"]);
      scrollToRef(documentsRef);
      return;
    }

    if (issue?.fixTarget === "eligibility") {
      navigate(`/journey?claimId=${claim.id}&stage=eligibility`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }

    if (issue?.fixTarget === "prior-auth") {
      navigate(`/journey?claimId=${claim.id}&stage=prior-auth`, {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Detail"
        }
      });
      return;
    }

    if (issue?.fixTarget === "serviceLines") {
      const targetField = issue?.field || "serviceLines";
      if (!editForm?.serviceLines?.length) {
        setEditForm((current) => ({
          ...current,
          serviceLines: [emptyServiceLine()]
        }));
      }
      openClaimEdit(targetField, [targetField]);
      return;
    }

    if (issue?.field) {
      openClaimEdit(issue.field, [issue.field]);
      return;
    }

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

    if (message.includes("billing provider npi")) {
      openClaimEdit("billingProviderNpi");
      return;
    }

    if (message.includes("rendering provider npi")) {
      openClaimEdit("renderingProviderNpi");
      return;
    }

    if (message.includes("cpt") || message.includes("hcpcs")) {
      openClaimEdit("cptHcpcsCode");
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

  function issueDisplayMessage(issue, { resolved = false } = {}) {
    const message = String(issue?.message || "");
    const normalized = message.toLowerCase();

    if (normalized.includes("eligibility has not been verified")) {
      return resolved
        ? "Eligibility is now verified."
        : "Patient insurance eligibility still needs to be checked.";
    }

    if (normalized.includes("prior authorization requirement is unresolved")) {
      return resolved
        ? "Prior authorization is now resolved."
        : "Confirm whether prior authorization is required for this claim.";
    }

    if (normalized.includes("billing provider npi is required")) {
      return "Add the billing provider NPI.";
    }

    if (normalized.includes("user-verified cpt/hcpcs")) {
      return "Add and verify at least one CPT/HCPCS service code.";
    }

    return message;
  }

  function fixButtonLabel(issue) {
    const message = String(issue?.message || "").toLowerCase();
    if (issue?.fixTarget === "documents" || message.includes("supporting document")) return "Upload Document";
    if (issue?.fixTarget === "eligibility" || message.includes("eligibility")) return "Check Eligibility";
    if (issue?.fixTarget === "prior-auth" || message.includes("prior authorization")) return "Review Prior Auth";
    if (issue?.fixTarget === "serviceLines") return "Edit Service Line";
    return "Fix Field";
  }

  React.useEffect(() => {
    if (!claim) return;

    const params = new URLSearchParams(location.search);
    const focusFields = String(params.get("focus") || location.state?.focus || "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const section = params.get("section");
    const autoEdit = params.get("edit") === "1";

    if (section === "documents" || focusFields.includes("documents")) {
      setFixFocus("documents");
      setFixFields(["documents"]);
      scrollToRef(documentsRef);
      return;
    }

    if (section === "readiness") {
      scrollToRef(readinessRef);
      return;
    }

    if (autoEdit && focusFields.length) {
      openClaimEdit(focusFields[0], focusFields);
      return;
    }

    if (location.state?.focus === "eligibility") {
      openClaimEdit("eligibility", ["eligibility"]);
    }
  }, [claim?.id, location.search]);

  React.useEffect(() => {
    if (!editMode || !fixFocus) return;
    if (["claim", "eligibility", "documents"].includes(fixFocus)) return;

    const timer = window.setTimeout(() => {
      const target = document.querySelector(
        `[data-fix-field="${fixFocus}"]`
      );
      if (!target) return;

      target.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      const input = target.querySelector(
        'input:not([type="hidden"]), textarea, [role="combobox"]'
      );
      input?.focus?.();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [editMode, fixFocus]);

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
    if (!canRunAI) return showToast("Only CASHIER/ADMIN can check claim readiness", "error");
    if (aiCheckLocked) {
      return showDialog(
        "This historical or finalized claim is locked. AI readiness cannot be recalculated unless the claim is reopened or amended.",
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
  const checkHistory = Array.isArray(claim.checks) ? claim.checks.slice(0, 5) : [];
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const hasBlock = issues.some((i) => i.severity === "BLOCK");
  const eligibilityClear = claim.eligibilityStatus === "VERIFIED";
  const priorAuthClear =
    claim.priorAuthStatus === "APPROVED" ||
    claim.priorAuthStatus === "NOT_REQUIRED";

  const completeness = claim.completenessSummary;
  const completenessByField = Object.fromEntries(
    (completeness?.fields || []).map((item) => [item.field, item])
  );

  function completenessValue(field, value, formatter = (v) => v) {
    const state = completenessByField[field]?.state;
    if (state === "not_applicable") return "N/A";
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return state === "missing" ? "Missing" : state === "review" ? "Needs Review" : "—";
    }
    return formatter(value);
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
    if (item.fixTarget === "coding-review") {
      navigate(`/documents?claimId=${claim.id}&reviewCoding=1`);
      return;
    }
    if (item.fixTarget === "serviceLines") {
      openClaimEdit("serviceLines", ["serviceLines"]);
      return;
    }
    openClaimEdit(item.field);
  }

  const claimFinalized =
    ["SUBMITTED", "DENIED", "PAID"].includes(claim.status) ||
    Boolean(claim.claimSubmissionDate);

  const canSubmit =
    !claimFinalized &&
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

        <Stack direction="row" spacing={1}>
          {isAdmin && (
            <Button variant="outlined" onClick={() => navigate(`/audit?claimId=${claim.id}`)}>
              View Audit Trail
            </Button>
          )}
          {isAdmin && !claimFinalized && (
            <Button color="error" startIcon={<DeleteForever />} onClick={deleteClaim}>
              Delete Claim
            </Button>
          )}
        </Stack>
      </Stack>

      <ClaimSummaryCard claim={claim} />

      <ClaimCompletenessCard
        completeness={completeness}
        automation={claim.automationSummary}
        onFixItem={fixCompletenessItem}
        claimStatus={claim.status}
      />

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
            <Typography variant="h5" fontWeight={800}>Patient & Policy</Typography>

            {canEditClaim && !["SUBMITTED", "DENIED", "PAID"].includes(claim.status) && !editMode && (
              <Button size="small" onClick={() => setEditMode(true)}>Edit</Button>
            )}
            {["SUBMITTED", "DENIED", "PAID"].includes(claim.status) && (
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
                    setFixFocus("");
                    setFixFields([]);
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
                <Typography variant="subtitle1" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                  Clinical
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
                  <FieldLine claim={claim} field="diagnosisText" label="Diagnosis">{claim.diagnosisText || "—"}</FieldLine>
                  <FieldLine claim={claim} field="icd10Codes" label="ICD-10">{claim.icd10Codes?.length ? claim.icd10Codes.join(", ") : "—"}</FieldLine>
                  <FieldLine claim={claim} field="doctorName" label="Doctor">{claim.doctorName || "—"}</FieldLine>
                  <FieldLine claim={claim} field="hospitalName" label="Hospital">{claim.hospitalName || "—"}</FieldLine>
                  <Typography><b>Billing NPI:</b> {claim.billingProviderNpi || "—"}</Typography>
                  <Typography><b>Rendering NPI:</b> {claim.renderingProviderNpi || "—"}</Typography>
                  <Typography><b>Referring NPI:</b> {claim.referringProviderNpi || "—"}</Typography>
                  <Typography><b>Provider TIN:</b> {claim.providerTin || "—"}</Typography>
                  <Typography><b>Taxonomy:</b> {claim.providerTaxonomyCode || "—"}</Typography>
                </Box>
              </Box>

              <Divider sx={{ gridColumn: "1 / -1" }} />

              <Box>
                <Typography variant="subtitle1" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                  Patient identity & coverage
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <FieldLine claim={claim} field="memberId" label="Member ID">{claim.memberId || "—"}</FieldLine>
                  <FieldLine claim={claim} field="medicalRecordNumber" label="MRN">{claim.medicalRecordNumber || "—"}</FieldLine>
                  <FieldLine claim={claim} field="patientDob" label="DOB">{formatUSDateOnly(claim.patientDob)}</FieldLine>
                  <FieldLine claim={claim} field="policyNo" label="Policy No">{claim.policyNo || "—"}</FieldLine>
                  <FieldLine claim={claim} field="payerName" label="Payer">{claim.payerName || "—"}</FieldLine>
                  <FieldLine claim={claim} field="planAdministratorName" label="Plan Administrator">{claim.planAdministratorName || "—"}</FieldLine>
                  <Typography><b>Policy Type:</b> {claim.productType || "—"}</Typography>
                  <Typography><b>Payer Reference:</b> {claim.payerReferenceNo || "—"}</Typography>
                  <Typography><b>Group Number:</b> {claim.groupNumber || "—"}</Typography>
                  <Typography><b>Subscriber ID:</b> {claim.subscriberId || "—"}</Typography>
                  <Typography><b>Subscriber:</b> {claim.subscriberName || "—"}</Typography>
                  <Typography><b>Relationship:</b> {claim.subscriberRelationship || "—"}</Typography>
                  <Typography><b>COB:</b> {claim.coordinationOfBenefits || "—"}</Typography>
                  <Typography><b>Payer EDI ID:</b> {claim.payerEdiId || "—"}</Typography>
                </Box>
              </Box>

              <Divider sx={{ gridColumn: "1 / -1" }} />

              <Box>
                <Typography variant="subtitle1" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                  Encounter
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <FieldLine claim={claim} field="dateOfService" label="Date of Service">{completenessValue("dateOfService", claim.dateOfService, formatUSDateOnly)}</FieldLine>
                  <Typography><b>Admission:</b> {completenessValue("admissionDate", claim.admissionDate, formatUSDateOnly)}</Typography>
                  <Typography><b>Discharge:</b> {completenessValue("dischargeDate", claim.dischargeDate, formatUSDateOnly)}</Typography>
                  <Typography><b>Admission Type:</b> {completenessValue("admissionType", claim.admissionType)}</Typography>
                  <Typography><b>Room Category:</b> {completenessValue("roomCategory", claim.roomCategory)}</Typography>
                  <Typography><b>ICU Days:</b> {completenessValue("icuDays", claim.icuDays)}</Typography>
                  <Typography><b>ICD-10-PCS:</b> {claim.inpatientProcedureCodes?.length ? claim.inpatientProcedureCodes.join(", ") : "—"}</Typography>
                  <Typography><b>Type of Bill:</b> {claim.typeOfBill || "—"}</Typography>
                  <Typography><b>DRG:</b> {claim.drgCode || "—"}</Typography>
                </Box>
              </Box>

              <Divider sx={{ gridColumn: "1 / -1" }} />

              <Box>
                <Typography variant="subtitle1" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                  Claim & financials
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  <Typography><b>Claim Form:</b> {claim.claimForm === "PROFESSIONAL" ? "Professional (837P)" : claim.claimForm === "INSTITUTIONAL" ? "Institutional (837I)" : "Legacy / not specified"}</Typography>
                  <FieldLine claim={claim} field="totalBilledAmount" label="Total Billed">{formatMoney(claim.totalBilledAmount)}</FieldLine>
                  <FieldLine claim={claim} field="amount" label="Claimed Amount">{formatMoney(claim.amount)}</FieldLine>
                  <FieldLine claim={claim} field="approvedAmount" label="Approved Amount">{formatMoney(claim.approvedAmount)}</FieldLine>
                  <FieldLine claim={claim} field="coverageLimit" label="Coverage Limit">{formatMoney(claim.coverageLimit)}</FieldLine>
                  <FieldLine claim={claim} field="remainingCoverageLimit" label="Remaining Coverage">{formatMoney(claim.remainingCoverageLimit)}</FieldLine>
                  <Typography><b>Insurer Claim No:</b> {claim.insurerClaimNo || "—"}</Typography>
                  <FieldLine claim={claim} field="authorizationNo" label="Authorization No">{claim.authorizationNo || "—"}</FieldLine>
                  <Typography><b>Submission Date:</b> {formatDate(claim.claimSubmissionDate)}</Typography>
                  <Typography><b>Frequency:</b> {claim.claimFrequencyCode || "ORIGINAL"}</Typography>
                  <Typography><b>Timely Filing Deadline:</b> {formatUSDateOnly(claim.timelyFilingDeadline)}</Typography>
                </Box>
              </Box>

              <Divider sx={{ gridColumn: "1 / -1" }} />

              <Box>
                <Typography variant="subtitle1" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                  Service Lines
                </Typography>
                <ServiceLinesEditor lines={claim.serviceLines || []} readOnly />
              </Box>
            </Stack>
          )}

          {editMode && editForm && (
            <Box
              sx={{
                mt: 1,
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(3, minmax(0, 1fr))"
                },
                gap: 2,
                alignItems: "start"
              }}
            >
              {fixFocus && (
                <Alert severity="warning" sx={{ gridColumn: "1 / -1" }}>
                  {new URLSearchParams(location.search).get("issue")
                    ? `Fixing: ${new URLSearchParams(location.search).get("issue")}. `
                    : ""}
                  The field that needs attention is highlighted below. Update it, then click Save Changes.
                </Alert>
              )}
              <TextField
                select
                label="Claim Form"
                value={editForm.claimForm}
                onChange={(e) => updateEditField("claimForm", e.target.value)}
                helperText="837P = Professional | 837I = Institutional"
                fullWidth
              >
                <MenuItem value="">Legacy / not specified</MenuItem>
                <MenuItem value="PROFESSIONAL">Professional (837P)</MenuItem>
                <MenuItem value="INSTITUTIONAL">Institutional (837I)</MenuItem>
              </TextField>
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
                data-fix-field="billingProviderNpi"
                label="Billing Provider NPI"
                value={editForm.billingProviderNpi}
                onChange={(e) => updateEditField("billingProviderNpi", normalizeNpi(e.target.value))}
                color={isFixField("billingProviderNpi") ? "warning" : "primary"}
                focused={isFixField("billingProviderNpi")}
                helperText={npiError(editForm.billingProviderNpi) || (isFixField("billingProviderNpi") ? "Enter the 10-digit billing provider NPI required for submission." : "Exactly 10 digits")}
                fullWidth
              />
              {editForm.claimForm === "PROFESSIONAL" && (
                <>
                  <TextField
                    data-fix-field="renderingProviderNpi"
                    label="Rendering Provider NPI"
                    value={editForm.renderingProviderNpi}
                    onChange={(e) => updateEditField("renderingProviderNpi", normalizeNpi(e.target.value))}
                    color={isFixField("renderingProviderNpi") ? "warning" : "primary"}
                    focused={isFixField("renderingProviderNpi")}
                    fullWidth
                  />
                  <TextField
                    data-fix-field="referringProviderNpi"
                    label="Referring Provider NPI"
                    value={editForm.referringProviderNpi}
                    onChange={(e) => updateEditField("referringProviderNpi", normalizeNpi(e.target.value))}
                    color={isFixField("referringProviderNpi") ? "warning" : "primary"}
                    focused={isFixField("referringProviderNpi")}
                    fullWidth
                  />
                </>
              )}
              <TextField label="Provider TIN" value={editForm.providerTin} onChange={(e) => updateEditField("providerTin", e.target.value.replace(/[^0-9-]/g, "").slice(0, 10))} fullWidth />
              <TextField label="Provider Taxonomy Code" value={editForm.providerTaxonomyCode} onChange={(e) => updateEditField("providerTaxonomyCode", normalizeTaxonomy(e.target.value))} fullWidth />
              <TextField
                data-fix-field="diagnosisText"
                label="Diagnosis"
                value={editForm.diagnosisText}
                color={isFixField("diagnosisText") ? "warning" : "primary"}
                focused={isFixField("diagnosisText")}
                onChange={(e) => updateEditField("diagnosisText", e.target.value)}
                fullWidth
              />
              <TextField
                label="ICD-10 Codes (comma separated)"
                value={editForm.icd10Codes}
                data-fix-field="icd10Codes"
                color={isFixField("icd10Codes") ? "warning" : "primary"}
                focused={isFixField("icd10Codes")}
                onChange={(e) => updateEditField("icd10Codes", e.target.value.toUpperCase())}
                fullWidth
              />
              <TextField
                label="Insurance Company"
                value={editForm.payerName}
                onChange={(e) => updateEditField("payerName", e.target.value)}
                fullWidth
              />
              <TextField
                data-fix-field="policyNo"
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
                label="Medical Record Number (MRN)"
                value={editForm.medicalRecordNumber}
                onChange={(e) => updateEditField("medicalRecordNumber", e.target.value)}
                fullWidth
              />
              <TextField
                label="Plan Administrator"
                value={editForm.planAdministratorName}
                onChange={(e) => updateEditField("planAdministratorName", e.target.value)}
                fullWidth
              />
              <TextField
                label="Group Number"
                value={editForm.groupNumber}
                onChange={(e) => updateEditField("groupNumber", e.target.value)}
                fullWidth
              />
              <TextField
                label="Subscriber ID"
                value={editForm.subscriberId}
                onChange={(e) => updateEditField("subscriberId", e.target.value)}
                fullWidth
              />
              <TextField
                label="Subscriber Name"
                value={editForm.subscriberName}
                onChange={(e) => updateEditField("subscriberName", e.target.value)}
                fullWidth
              />
              <TextField
                select
                label="Subscriber Relationship"
                value={editForm.subscriberRelationship}
                onChange={(e) => updateEditField("subscriberRelationship", e.target.value)}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="SELF">Self</MenuItem>
                <MenuItem value="SPOUSE">Spouse</MenuItem>
                <MenuItem value="CHILD">Child</MenuItem>
                <MenuItem value="OTHER">Other</MenuItem>
              </TextField>
              <TextField
                select
                label="Coordination of Benefits"
                value={editForm.coordinationOfBenefits}
                onChange={(e) => updateEditField("coordinationOfBenefits", e.target.value)}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="PRIMARY">Primary</MenuItem>
                <MenuItem value="SECONDARY">Secondary</MenuItem>
                <MenuItem value="TERTIARY">Tertiary</MenuItem>
              </TextField>
              <TextField
                label="Payer EDI ID"
                value={editForm.payerEdiId}
                onChange={(e) => updateEditField("payerEdiId", e.target.value)}
                fullWidth
              />
              <TextField
                label="Payer Reference Number"
                value={editForm.payerReferenceNo}
                onChange={(e) => updateEditField("payerReferenceNo", e.target.value)}
                fullWidth
              />
              <TextField
                label="Patient Date of Birth"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.patientDob}
                onChange={(e) => updateEditField("patientDob", e.target.value)}
                fullWidth
              />
              <Divider sx={{ gridColumn: "1 / -1" }} />
              <Typography variant="subtitle1" fontWeight={800} sx={{ gridColumn: "1 / -1" }}>Encounter Details</Typography>
              <TextField
                data-fix-field="dateOfService"
                label="Date of Service"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.dateOfService}
                onChange={(e) => updateEditField("dateOfService", e.target.value)}
                color={isFixField("dateOfService") ? "warning" : "primary"}
                focused={isFixField("dateOfService")}
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  data-fix-field="admissionDate"
                  label="Admission Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={editForm.admissionDate}
                  onChange={(e) => updateEditField("admissionDate", e.target.value)}
                  color={isFixField("admissionDate") ? "warning" : "primary"}
                  focused={isFixField("admissionDate")}
                  fullWidth
                />
                <TextField
                  data-fix-field="dischargeDate"
                  label="Discharge Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={editForm.dischargeDate}
                  onChange={(e) => updateEditField("dischargeDate", e.target.value)}
                  color={isFixField("dischargeDate") ? "warning" : "primary"}
                  focused={isFixField("dischargeDate")}
                  fullWidth
                />
              </Stack>
              <TextField
                data-fix-field="admissionType"
                select
                label="Admission Type"
                value={editForm.admissionType}
                onChange={(e) => updateEditField("admissionType", e.target.value)}
                color={isFixField("admissionType") ? "warning" : "primary"}
                focused={isFixField("admissionType")}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="PLANNED">Planned</MenuItem>
                <MenuItem value="EMERGENCY">Emergency</MenuItem>
              </TextField>
              <TextField
                data-fix-field="roomCategory"
                select
                label="Room Category"
                value={editForm.roomCategory}
                onChange={(e) => updateEditField("roomCategory", e.target.value)}
                color={isFixField("roomCategory") ? "warning" : "primary"}
                focused={isFixField("roomCategory")}
                fullWidth
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="GENERAL">General</MenuItem>
                <MenuItem value="SEMI_PRIVATE">Semi Private</MenuItem>
                <MenuItem value="PRIVATE">Private</MenuItem>
                <MenuItem value="ICU">ICU</MenuItem>
              </TextField>
              <TextField
                data-fix-field="icuDays"
                label="ICU Days"
                type="number"
                inputProps={{ min: 0 }}
                value={editForm.icuDays}
                onChange={(e) => updateEditField("icuDays", e.target.value)}
                color={isFixField("icuDays") ? "warning" : "primary"}
                focused={isFixField("icuDays")}
                fullWidth
              />
              <TextField
                data-fix-field="procedureText"
                label="Procedure"
                value={editForm.procedureText}
                onChange={(e) => updateEditField("procedureText", e.target.value)}
                color={isFixField("procedureText") ? "warning" : "primary"}
                focused={isFixField("procedureText")}
                fullWidth
              />
              <TextField
                data-fix-field="procedureDate"
                label="Procedure Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.procedureDate}
                onChange={(e) => updateEditField("procedureDate", e.target.value)}
                color={isFixField("procedureDate") ? "warning" : "primary"}
                focused={isFixField("procedureDate")}
                fullWidth
              />

              <TextField
                label="Coverage Limit (USD)"
                type="number"
                value={editForm.coverageLimit}
                onChange={(e) => updateEditField("coverageLimit", e.target.value)}
                fullWidth
              />
              <TextField
                label="Remaining Coverage Limit (USD)"
                type="number"
                value={editForm.remainingCoverageLimit}
                onChange={(e) => updateEditField("remainingCoverageLimit", e.target.value)}
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
                data-fix-field="amount"
                label="Total Claimed Amount ($)"
                type="number"
                value={editForm.amount}
                color={fixFocus === "amount" ? "warning" : "primary"}
                focused={fixFocus === "amount"}
                onChange={(e) => updateEditField("amount", e.target.value)}
                fullWidth
              />
              <Divider sx={{ gridColumn: "1 / -1" }} />
              <Typography variant="subtitle1" fontWeight={800} sx={{ gridColumn: "1 / -1" }}>U.S. Claim Details</Typography>
              <TextField
                label="ICD-10-PCS Codes (comma separated)"
                value={editForm.inpatientProcedureCodes}
                onChange={(e) => updateEditField("inpatientProcedureCodes", e.target.value.toUpperCase())}
                fullWidth
              />
              <TextField
                data-fix-field="typeOfBill"
                label="Type of Bill"
                value={editForm.typeOfBill}
                onChange={(e) => updateEditField("typeOfBill", e.target.value)}
                color={isFixField("typeOfBill") ? "warning" : "primary"}
                focused={isFixField("typeOfBill")}
                fullWidth
              />
              <TextField
                label="DRG"
                value={editForm.drgCode}
                onChange={(e) => updateEditField("drgCode", e.target.value)}
                fullWidth
              />
              <TextField
                select
                label="Claim Frequency"
                value={editForm.claimFrequencyCode}
                onChange={(e) => {
                  const frequency = e.target.value;
                  updateEditField("claimFrequencyCode", frequency);
                  if (editForm.typeOfBill) {
                    updateEditField("typeOfBill", typeOfBillFor(editForm.typeOfBill.slice(0, 3), frequency));
                  }
                }}
                fullWidth
              >
                <MenuItem value="ORIGINAL">Original</MenuItem>
                <MenuItem value="CORRECTED">Corrected</MenuItem>
                <MenuItem value="VOID">Void</MenuItem>
              </TextField>
              <TextField
                label="Timely Filing Deadline"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={editForm.timelyFilingDeadline}
                onChange={(e) => updateEditField("timelyFilingDeadline", e.target.value)}
                fullWidth
              />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>Service Lines</Typography>
                <ServiceLinesEditor
                  lines={editForm.serviceLines || []}
                  onChange={(serviceLines) => updateEditField("serviceLines", serviceLines)}
                  highlightField={
                    ["serviceLines", "cptHcpcsCode", "diagnosisPointers", "placeOfService", "revenueCode"].includes(fixFocus)
                      ? fixFocus
                      : ""
                  }
                  claimForm={editForm.claimForm}
                  diagnosisCodes={String(editForm.icd10Codes || "").split(",").map(normalizeIcd10Cm).filter(Boolean)}
                />
              </Box>
            </Box>
          )}

          {editMode && (
            <Paper
              elevation={6}
              sx={{
                position: "fixed",
                right: { xs: 16, md: 32 },
                bottom: { xs: 16, md: 24 },
                zIndex: 1300,
                px: 1.25,
                py: 1,
                borderRadius: 2,
                display: "flex",
                gap: 1,
                alignItems: "center"
              }}
            >
              <Button
                size="small"
                disabled={savingEdit}
                onClick={() => {
                  resetEditForm();
                  setEditMode(false);
                  setFixFocus("");
                  setFixFields([]);
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
                {savingEdit ? "Saving..." : "Save Changes"}
              </Button>
            </Paper>
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
              <Divider sx={{ gridColumn: "1 / -1" }} />
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
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            gap={2}
          >
            <Typography variant="h6">Claim Readiness for Submission</Typography>

            <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={runAICheck}
                disabled={aiRunning || !canRunAI || aiCheckLocked}
              >
                {aiRunning
                  ? "Checking..."
                  : check?.isStale
                  ? "Recheck Readiness"
                  : check
                  ? "Check Readiness Again"
                  : "Check Readiness"}
              </Button>

              <Button
                variant="contained"
                color="success"
                onClick={submitClaim}
                disabled={!canSubmit || submittingClaim || claimFinalized}
              >
                {claim.status === "PAID"
                  ? "Paid"
                  : claim.status === "DENIED"
                  ? "Denied"
                  : claim.status === "SUBMITTED" || claim.claimSubmissionDate
                  ? "Submitted"
                  : submittingClaim
                  ? "Submitting..."
                  : "Submit Claim"}
              </Button>
            </Stack>
          </Stack>

          {claim.status !== "SUBMITTED" && (!eligibilityClear || !priorAuthClear) && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Complete eligibility and prior authorization in Claim Journey before submission.
            </Alert>
          )}

          {claim.status === "SUBMITTED" && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Claim submitted{claim.claimSubmissionDate ? ` on ${formatDate(claim.claimSubmissionDate)}` : ""}. Claim data and documents are locked.
            </Alert>
          )}

          {!check && aiCheckLocked && (
            <Alert severity="info" sx={{ mt: 2 }}>
              No historical readiness check is available for this finalized claim.
            </Alert>
          )}

          {check && (
            <>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "flex-end" }}
                spacing={1}
                sx={{ mt: 2 }}
              >
                <Typography
                  variant="h3"
                  fontWeight={850}
                  lineHeight={1}
                  sx={{ color: readinessTextColor(check.score) }}
                  data-testid="readiness-score"
                >
                  {check.score}%
                </Typography>

                <Typography variant="caption" color="text.secondary">
                  Checked {new Date(check.createdAt).toLocaleString()}
                </Typography>
              </Stack>

              <Box sx={{ mt: 1.5, mb: 2.25 }}>
                <Box
                  data-testid="readiness-progress"
                  sx={{
                    position: "relative",
                    height: 14,
                    borderRadius: 999,
                    overflow: "hidden",
                    backgroundColor: "action.hover"
                  }}
                >
                  <Box
                    sx={{
                      height: "100%",
                      width: `${Math.max(0, Math.min(100, Number(check.score) || 0))}%`,
                      borderRadius: 999,
                      transition: "width 650ms ease",
                      backgroundColor:
                        check.score >= 80
                          ? "success.main"
                          : check.score >= 50
                          ? "warning.main"
                          : "error.main"
                    }}
                  />
                  <Box
                    title="80% submission threshold"
                    sx={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: "80%",
                      width: 2,
                      backgroundColor: "text.primary",
                      opacity: 0.28
                    }}
                  />
                </Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    0
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Submit threshold 80%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    100
                  </Typography>
                </Stack>
              </Box>

              {check.isStale ? (
                <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="readiness-stale">
                  Claim information changed. Recheck readiness to recalculate the score and current blockers.
                </Alert>
              ) : issues.length === 0 ? (
                <Alert severity="success" sx={{ mb: 1.5 }}>
                  No readiness issues found. This claim can be submitted.
                </Alert>
              ) : (
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Fix before submission
                  </Typography>

                  {issues
                    .filter((issue) => ["BLOCK", "WARN"].includes(issue.severity))
                    .map((issue, idx) => (
                      <Paper
                        key={idx}
                        data-testid={`readiness-issue-${issue.rule || issue.field || issue.fixTarget || idx}`}
                        variant="outlined"
                        sx={{
                          px: 1.5,
                          py: 1.25,
                          borderColor:
                            issue.severity === "BLOCK"
                              ? "error.light"
                              : "warning.light",
                          borderLeftWidth: 4
                        }}
                      >
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          alignItems={{ xs: "stretch", sm: "center" }}
                          justifyContent="space-between"
                          spacing={1.25}
                        >
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              size="small"
                              variant="outlined"
                              label={issue.severity}
                              color={issue.severity === "BLOCK" ? "error" : "warning"}
                            />
                            <Typography variant="body2" fontWeight={600}>
                              {issueDisplayMessage(issue)}
                            </Typography>
                          </Stack>

                          <Button
                            size="small"
                            variant="outlined"
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

                  {!hasBlock && check.score >= 80 && (
                    <Typography variant="caption" color="success.main" fontWeight={700}>
                      Submission threshold met. Remaining warnings do not block submission.
                    </Typography>
                  )}
                </Stack>
              )}

              {checkHistory.length > 1 && (
                <Box sx={{ mt: 1.5 }}>
                  <Button
                    size="small"
                    variant="text"
                    endIcon={readinessHistoryExpanded ? <ExpandLess /> : <ExpandMore />}
                    onClick={() => setReadinessHistoryExpanded((value) => !value)}
                  >
                    {readinessHistoryExpanded
                      ? "Hide readiness history"
                      : `Readiness history (${checkHistory.length})`}
                  </Button>

                  <Collapse in={readinessHistoryExpanded}>
                    <Stack spacing={0.75} sx={{ mt: 1 }}>
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
                              variant="outlined"
                              label={`${item.score}%`}
                            />
                            <Typography variant="body2">
                              {new Date(item.createdAt).toLocaleString()}
                            </Typography>
                            {item.isStale && (
                              <Chip size="small" variant="outlined" label="Out of date" />
                            )}
                            {index === 0 && !item.isStale && (
                              <Chip size="small" variant="outlined" color="success" label="Current" />
                            )}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              )}
            </>
          )}

          {!check && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Run readiness to calculate the score and show only the fields that need attention.
            </Typography>
          )}
        </CardContent>
      </Card>

      <AICheckProgress open={aiRunning} />
    </Box>
  );
}