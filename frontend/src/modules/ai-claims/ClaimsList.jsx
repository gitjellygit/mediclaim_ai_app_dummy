import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
  TableContainer,
  Paper,
  Checkbox,
  TextField,
  InputAdornment,
  IconButton,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Alert,
  Divider,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from "@mui/material";
import {
  Search as SearchIcon,
  Refresh,
  Visibility,
  Delete,
  AutoAwesome,
  CloudUpload,
  CheckCircle,
  ErrorOutline,
  ContentCopy,
  CloudDownload
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { IntegrationsApi } from "../../api/integrations.js";
import { useToast } from "../../context/ToastContext.jsx";
import { AuthApi } from "../../api/auth.js";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { formatUSD } from "../../utils/currency.js";
import { humanizeEnum } from "../../utils/displayLabels.js";
import ClaimAssignmentDialog from "../../components/ClaimAssignmentDialog.jsx";

const statusColor = {
  DRAFT: "default",
  READY: "info",
  SUBMITTING: "warning",
  SUBMITTED: "warning",
  PAID: "success",
  REJECTED: "error"
};

export default function ClaimsList() {
  const user = AuthApi.getUser();
  const canCreateFullClaim = hasPermission(user, PERMISSIONS.CLINICAL_EDIT);
  const canCreateFromDocuments =
    hasPermission(user, PERMISSIONS.DOCUMENT_VIEW) &&
    hasPermission(user, PERMISSIONS.CLAIM_EDIT);
  const canDeleteClaims = hasPermission(user, PERMISSIONS.CLAIM_DELETE);
  const canImportFromEhr =
    hasPermission(user, PERMISSIONS.INTEGRATION_VIEW) &&
    hasPermission(user, PERMISSIONS.INTEGRATION_INGEST);
  const canManageAssignments = hasPermission(user, PERMISSIONS.CLAIM_EDIT);
  const canSelectClaims = canDeleteClaims || canManageAssignments;
  const canViewFinancial = hasPermission(user, PERMISSIONS.FINANCIAL_VIEW);
  const [claims, setClaims] = useState([]);
  const [totalClaims, setTotalClaims] = useState(0);
  const [statusSummary, setStatusSummary] = useState({});
  const [claimsPage, setClaimsPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [selected, setSelected] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("desc");
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  const [aiFiles, setAiFiles] = useState([]);
  const [aiCreating, setAiCreating] = useState(false);
  const [aiResults, setAiResults] = useState([]);
  const [aiCreatedClaimId, setAiCreatedClaimId] = useState("");
  const [assignmentTarget, setAssignmentTarget] = useState(null);
  const [ehrDialogOpen, setEhrDialogOpen] = useState(false);
  const [ehrConnections, setEhrConnections] = useState([]);
  const [ehrConnectionId, setEhrConnectionId] = useState("");
  const [ehrPatientId, setEhrPatientId] = useState("");
  const [ehrEncounterId, setEhrEncounterId] = useState("");
  const [ehrEncounterResults, setEhrEncounterResults] = useState([]);
  const [ehrEncounterSearchBusy, setEhrEncounterSearchBusy] = useState(false);
  const [ehrEncounterInfo, setEhrEncounterInfo] = useState(null);
  const [ehrBusy, setEhrBusy] = useState(false);
  const [ehrCancelable, setEhrCancelable] = useState(false);
  const ehrFetchAbortRef = useRef(null);
  const [ehrPatientSearchBusy, setEhrPatientSearchBusy] = useState(false);
  const [ehrAdvancedSearch, setEhrAdvancedSearch] = useState(false);
  const [ehrPatientResults, setEhrPatientResults] = useState([]);
  const [ehrSelectedPatient, setEhrSelectedPatient] = useState(null);
  const [ehrPatientSearchInfo, setEhrPatientSearchInfo] = useState(null);
  const [ehrSearch, setEhrSearch] = useState({
    smart: "",
    patientId: "",
    identifier: "",
    identifierSystem: "",
    name: "",
    family: "",
    given: "",
    birthdate: "",
    birthdateFrom: "",
    birthdateTo: "",
    phone: "",
    email: "",
    postalCode: "",
    gender: "",
    exactName: false,
    count: 20
  });
  const [ehrPreview, setEhrPreview] = useState(null);
  const [ehrResult, setEhrResult] = useState(null);
  const [ehrCreatedClaimId, setEhrCreatedClaimId] = useState("");
  const navigate = useNavigate();
  const { showToast, showDialog, confirmDialog } = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchTerm.trim());
      setClaimsPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    loadClaims({ page: claimsPage + 1 });
  }, [sort, direction, query, claimsPage, rowsPerPage]);

  async function loadClaims({ page = claimsPage + 1 } = {}) {
    try {
      setLoadingClaims(true);
      const data = await ClaimsApi.list({
        page,
        pageSize: rowsPerPage,
        paginated: true,
        sort,
        direction,
        q: query
      });
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];
      setClaims(items);
      setTotalClaims(Number(data?.total ?? items.length));
      setStatusSummary(data?.statusSummary || {});
      setSelected([]);
    } catch (e) {
      console.error("Failed to load claims:", e);
      setClaims([]);
    } finally {
      setLoadingClaims(false);
    }
  }

  function handleSort(field) {
    setClaimsPage(0);
    if (sort === field) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(field);
    setDirection(field === "createdAt" || field === "amount" ? "desc" : "asc");
  }

  const filteredClaims = claims;

  const allSelected =
    filteredClaims.length > 0 &&
    filteredClaims.every(c => selected.includes(c.id));

  const someSelected =
    filteredClaims.some(c => selected.includes(c.id)) && !allSelected;

  function handleSelectAll() {
    if (allSelected) {
      setSelected(prev =>
        prev.filter(id => !filteredClaims.some(c => c.id === id))
      );
    } else {
      const newIds = filteredClaims.map(c => c.id);
      setSelected(prev => [...new Set([...prev, ...newIds])]);
    }
  }

  function handleSelectOne(id) {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  }

  async function handleDeleteClaim(id) {
    const ok = await confirmDialog(
      "This will permanently delete the claim and its associated documents. This action cannot be undone.",
      {
        title: "Delete claim?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    try {
      await ClaimsApi.delete(id);
      await loadClaims();
    } catch (error) {
      console.error("Delete claim failed:", error);
      showDialog(
        error?.message || "Unable to delete claim. Please try again.",
        {
          title: "Claim could not be deleted",
          severity: "error"
        }
      );
    }
  }

  // Bulk deletion is intentionally sequential so each protected claim can
  // return its own lifecycle error without hiding which records were affected.
  async function handleBulkDelete() {
    const ok = await confirmDialog(
      `Delete ${selected.length} selected claim${selected.length === 1 ? "" : "s"}? Protected submitted/paid claims will not be removed.`,
      {
        title: "Delete selected claims?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    const results = [];

    for (const id of selected) {
      const claim = claims.find((item) => item.id === id);

      try {
        await ClaimsApi.delete(id);
        results.push({
          id,
          name: claim?.patientName || "Claim",
          deleted: true
        });
      } catch (error) {
        console.error("Bulk claim delete item failed:", {
          claimId: id,
          status: error?.status,
          message: error?.message
        });

        results.push({
          id,
          name: claim?.patientName || "Claim",
          deleted: false,
          message: error?.message || "Delete failed"
        });
      }
    }

    const deleted = results.filter((item) => item.deleted);
    const failed = results.filter((item) => !item.deleted);

    setSelected([]);
    await loadClaims();

    if (failed.length === 0) {
      showToast(
        `${deleted.length} claim${deleted.length === 1 ? "" : "s"} deleted successfully.`,
        "success"
      );
      return;
    }

    const protectedFailures = failed.filter((item) =>
      /submitted|finalized|paid|locked/i.test(item.message || "")
    );
    const unexpectedFailures = failed.filter(
      (item) => !protectedFailures.includes(item)
    );

    if (deleted.length === 0 && protectedFailures.length === failed.length) {
      showDialog(
        [
          `${failed.length} selected claim${failed.length === 1 ? "" : "s"} could not be deleted because submitted or finalized claims are locked to preserve billing and audit history.`,
          "",
          "No records were changed."
        ].join("\n"),
        {
          title: "No claims were deleted",
          severity: "warning"
        }
      );
      return;
    }

    const summary = [
      deleted.length > 0
        ? `${deleted.length} claim${deleted.length === 1 ? "" : "s"} deleted successfully.`
        : null,
      protectedFailures.length > 0
        ? `${protectedFailures.length} submitted or finalized claim${protectedFailures.length === 1 ? " was" : "s were"} retained because locked claims cannot be deleted.`
        : null,
      unexpectedFailures.length > 0
        ? `${unexpectedFailures.length} claim${unexpectedFailures.length === 1 ? "" : "s"} could not be deleted due to an unexpected error. Please retry, and contact support if the issue continues.`
        : null
    ].filter(Boolean);

    showDialog(
      summary.join("\n\n"),
      {
        title:
          deleted.length > 0
            ? "Bulk delete completed with exceptions"
            : "Claims could not be deleted",
        severity: "warning"
      }
    );
  }


  async function openEhrImport() {
    setEhrDialogOpen(true);
    setEhrPreview(null);
    setEhrResult(null);
    setEhrCreatedClaimId("");
    setEhrPatientId("");
    setEhrEncounterId("");
    setEhrEncounterResults([]);
    setEhrEncounterInfo(null);
    setEhrPatientResults([]);
    setEhrSelectedPatient(null);
    setEhrPatientSearchInfo(null);
    setEhrAdvancedSearch(false);
    setEhrSearch({
      smart: "",
      patientId: "",
      identifier: "",
      identifierSystem: "",
      name: "",
      family: "",
      given: "",
      birthdate: "",
      birthdateFrom: "",
      birthdateTo: "",
      phone: "",
      email: "",
      postalCode: "",
      gender: "",
      exactName: false,
      count: 20
    });
    try {
      const data = await IntegrationsApi.list();
      const supported = (data.items || []).filter((item) => {
        if (item.kind !== "EHR" || item.status !== "ACTIVE") return false;
        const provider = String(item.provider || "").toLowerCase();
        return provider.includes("oracle") || provider.includes("cerner") || provider.includes("epic");
      });
      setEhrConnections(supported);
      setEhrConnectionId((current) =>
        supported.some((item) => item.id === current)
          ? current
          : (supported[0]?.id || "")
      );
      if (!supported.length) {
        setEhrResult({
          severity: "warning",
          message: "No active supported EHR connection is available. Configure and test one in Integration Hub first."
        });
      }
    } catch (error) {
      setEhrConnections([]);
      setEhrResult({
        severity: "error",
        message: error?.message || "Unable to load active EHR connections."
      });
    }
  }

  function closeEhrImport() {
    if (ehrBusy) return;
    setEhrDialogOpen(false);
  }

  function selectedEhrConnection() {
    return ehrConnections.find((item) => item.id === ehrConnectionId) || null;
  }

  function updateEhrSearch(field, value) {
    setEhrSearch((current) => ({ ...current, [field]: value }));
    setEhrPatientSearchInfo(null);
  }

  function patientSearchCriteria() {
    const criteria = {
      patientId: ehrSearch.patientId.trim(),
      identifier: ehrSearch.identifier.trim(),
      identifierSystem: ehrSearch.identifierSystem.trim(),
      name: ehrSearch.name.trim(),
      family: ehrSearch.family.trim(),
      given: ehrSearch.given.trim(),
      birthdate: ehrSearch.birthdate,
      birthdateFrom: ehrSearch.birthdateFrom,
      birthdateTo: ehrSearch.birthdateTo,
      phone: ehrSearch.phone.trim(),
      email: ehrSearch.email.trim(),
      postalCode: ehrSearch.postalCode.trim(),
      gender: ehrSearch.gender || undefined,
      exactName: Boolean(ehrSearch.exactName),
      count: Number(ehrSearch.count) || 20
    };

    const smart = ehrSearch.smart.trim();
    if (smart) {
      if (/^id:/i.test(smart) && !criteria.patientId) {
        criteria.patientId = smart.replace(/^id:/i, "").trim();
      } else if (/^mrn:/i.test(smart) && !criteria.identifier) {
        criteria.identifier = smart.replace(/^mrn:/i, "").trim();
      } else if (smart.includes("@") && !criteria.email) {
        criteria.email = smart;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(smart) && !criteria.birthdate) {
        criteria.birthdate = smart;
      } else if (/^[+()0-9 .-]{7,}$/.test(smart) && !criteria.phone) {
        criteria.phone = smart;
      } else if (!criteria.name && !criteria.family && !criteria.given) {
        criteria.name = smart;
      }
    }

    return Object.fromEntries(
      Object.entries(criteria).filter(([, value]) =>
        value !== "" && value !== undefined && value !== null
      )
    );
  }

  async function searchEhrPatients() {
    const connection = selectedEhrConnection();
    if (!connection) {
      setEhrPatientSearchInfo({ severity: "warning", message: "Select an active EHR connection first." });
      return;
    }

    const criteria = patientSearchCriteria();
    const meaningful = Object.keys(criteria).filter((key) => !["count", "exactName"].includes(key));
    if (!meaningful.length) {
      setEhrPatientSearchInfo({ severity: "warning", message: "Enter at least one patient search criterion." });
      return;
    }
    if (criteria.given && !criteria.family) {
      setEhrPatientSearchInfo({
        severity: "warning",
        message: "Oracle Health requires last/family name when searching by first/given name."
      });
      return;
    }
    if (criteria.identifier && !criteria.identifierSystem && !criteria.identifier.includes("|")) {
      setEhrPatientSearchInfo({
        severity: "warning",
        message: "For MRN/identifier search, enter the identifier system / assigning authority."
      });
      return;
    }
    if (criteria.birthdate && (criteria.birthdateFrom || criteria.birthdateTo)) {
      setEhrPatientSearchInfo({
        severity: "warning",
        message: "Use either exact DOB or a DOB range, not both."
      });
      return;
    }

    setEhrPatientSearchBusy(true);
    setEhrPatientResults([]);
    setEhrPatientSearchInfo({ severity: "info", message: "Searching the selected EHR…" });
    setEhrPatientId("");
    setEhrSelectedPatient(null);
    setEhrEncounterId("");
    setEhrEncounterResults([]);
    setEhrEncounterInfo(null);
    setEhrPreview(null);
    setEhrCreatedClaimId("");

    try {
      const result = await IntegrationsApi.searchPatients(connection.id, criteria);
      setEhrPatientResults(result.items || []);
      if (!(result.items || []).length) {
        setEhrPatientSearchInfo({
          severity: "warning",
          message: "No matching patients found. Adjust the search criteria and try again."
        });
      } else {
        setEhrPatientSearchInfo({
          severity: "success",
          message:
            (result.items || []).length +
            " patient" +
            ((result.items || []).length === 1 ? "" : "s") +
            " found" +
            (result.hasMore ? ". More matches exist; narrow the search to find the correct patient." : ".")
        });
      }
    } catch (error) {
      setEhrPatientSearchInfo({
        severity: "error",
        message: error?.message || "Patient search failed."
      });
    } finally {
      setEhrPatientSearchBusy(false);
    }
  }

  function selectEhrPatient(patient) {
    setEhrPatientId(String(patient.id));
    setEhrSelectedPatient(patient);
    setEhrEncounterId("");
    setEhrPreview(null);
    setEhrCreatedClaimId("");
    setEhrPatientSearchInfo(null);
  }

  async function useEncounterForClaim(encounter) {
    setEhrEncounterId(encounter.id);
    setEhrPreview(null);
    setEhrResult(null);
    await fetchEhrClaimData(encounter.id);
  }

  function changeEhrPatient() {
    setEhrPatientId("");
    setEhrSelectedPatient(null);
    setEhrEncounterId("");
    setEhrPreview(null);
    setEhrResult(null);
    setEhrCreatedClaimId("");
  }

  async function findBillableEncounters() {
    const connection = selectedEhrConnection();
    const patientId = ehrPatientId.trim();
    if (!connection || !patientId) return;

    setEhrEncounterSearchBusy(true);
    setEhrEncounterResults([]);
    setEhrEncounterInfo({ severity: "info", message: "Checking recent completed visits for billable charges…" });
    setEhrEncounterId("");
    setEhrPreview(null);
    setEhrResult(null);

    try {
      const result = await IntegrationsApi.billableEncounters(connection.id, patientId, 25);
      const items = result.items || [];
      setEhrEncounterResults(items);
      if (!items.length) {
        setEhrEncounterInfo({
          severity: "warning",
          message: "No completed encounters were returned for this patient."
        });
      } else if (!result.billableCount) {
        setEhrEncounterInfo({
          severity: "warning",
          message: "Visits were found, but none currently contain a positive billable ChargeItem."
        });
      } else {
        setEhrEncounterInfo({
          severity: "success",
          message: result.billableCount + " billable visit" + (result.billableCount === 1 ? "" : "s") + " found."
        });
      }
    } catch (error) {
      setEhrEncounterInfo({
        severity: "error",
        message: error?.message || "Unable to discover billable visits."
      });
    } finally {
      setEhrEncounterSearchBusy(false);
    }
  }

  async function syncSelectedEhr(connection, patientId, encounterId = ehrEncounterId, { signal } = {}) {
    const provider = String(connection?.provider || "").toLowerCase();
    if (provider.includes("oracle") || provider.includes("cerner")) {
      return IntegrationsApi.syncOracleHealth(connection.id, patientId, encounterId, { signal });
    }
    if (provider.includes("epic")) {
      return IntegrationsApi.syncEpic(connection.id, patientId);
    }
    const error = new Error("This EHR provider does not yet support direct patient import.");
    error.code = "EHR_PROVIDER_UNSUPPORTED";
    throw error;
  }

  async function fetchEhrClaimData(encounterOverride = ehrEncounterId) {
    const connection = selectedEhrConnection();
    const patientId = ehrPatientId.trim();

    if (!connection) {
      setEhrResult({ severity: "warning", message: "Select an active EHR connection." });
      return;
    }
    if (!patientId) {
      setEhrResult({ severity: "warning", message: "Enter the EHR patient ID." });
      return;
    }

    ehrFetchAbortRef.current?.abort();
    const controller = new AbortController();
    ehrFetchAbortRef.current = controller;
    setEhrBusy(true);
    setEhrCancelable(true);
    setEhrPreview(null);
    setEhrCreatedClaimId("");
    setEhrResult({
      severity: "info",
      message: "Fetching patient, insurance, encounter, diagnosis, and billing data from the EHR…"
    });

    try {
      await syncSelectedEhr(connection, patientId, encounterOverride, { signal: controller.signal });
      const preview = await IntegrationsApi.claimDraftPreview(
        connection.id,
        patientId,
        encounterOverride,
        { signal: controller.signal }
      );
      setEhrPreview(preview);

      if (!preview.ready) {
        setEhrResult({
          severity: "warning",
          message: preview.message
        });
        return;
      }

      setEhrResult({
        severity: preview.ready ? "success" : "warning",
        message: preview.ready
          ? "EHR data fetched successfully. Review the details below, then create the draft claim."
          : "EHR data fetched, but a claim cannot be created yet because required billing data is missing."
      });
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        setEhrResult({
          severity: "info",
          message: "EHR fetch cancelled."
        });
      } else {
        setEhrResult({
          severity: "error",
          message: error?.message || "Unable to fetch claim data from the EHR."
        });
      }
    } finally {
      if (ehrFetchAbortRef.current === controller) {
        ehrFetchAbortRef.current = null;
      }
      setEhrCancelable(false);
      setEhrBusy(false);
    }
  }

  function cancelEhrFetch() {
    ehrFetchAbortRef.current?.abort();
    setEhrCancelable(false);
  }

  async function createEhrDraftFromPreview() {
    const connection = selectedEhrConnection();
    if (!connection || !ehrPreview?.ready) return;
    setEhrBusy(true);
    try {
      const result = await IntegrationsApi.createClaimDraft(
        connection.id,
        ehrPatientId.trim(),
        ehrPreview.encounterId || ""
      );
      setEhrCreatedClaimId(result.claimId);
      await loadClaims({ page: 1 });
      setClaimsPage(0);
      setEhrDialogOpen(false);
      navigate(`/claims/${result.claimId}`);
    } catch (error) {
      setEhrResult({
        severity: "error",
        message: error?.message || "Unable to create the draft claim."
      });
    } finally {
      setEhrBusy(false);
    }
  }

  function openAiCreate() {
    setAiFiles([]);
    setAiResults([]);
    setAiCreatedClaimId("");
    setAiCreateOpen(true);
  }

  function closeAiCreate() {
    if (aiCreating) return;
    setAiCreateOpen(false);
  }

  function handleAiFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const supported = files.filter((file) =>
      ["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(file.type)
    );

    if (supported.length !== files.length) {
      showDialog(
        "Only PDF, PNG, JPG, and JPEG files are supported for AI claim creation.",
        {
          title: "Unsupported document type",
          severity: "warning"
        }
      );
    }

    setAiFiles(supported);
    setAiResults([]);
    setAiCreatedClaimId("");
    event.target.value = "";
  }

  /**
   * Documents are processed sequentially so the first upload can create the
   * claim and later uploads can safely match/merge into the same encounter.
   * Mutating uploads are not auto-retried because a lost response could cause
   * duplicate side effects; duplicate detection on the backend remains the
   * final safety net.
   */
  async function createClaimFromDocuments() {
    if (aiFiles.length === 0) {
      showDialog(
        "Select at least one clinical or billing document before starting AI claim creation.",
        {
          title: "No documents selected",
          severity: "warning"
        }
      );
      return;
    }

    setAiCreating(true);
    setAiResults([]);
    setAiCreatedClaimId("");

    const results = [];
    let claimId = "";

    for (const file of aiFiles) {
      try {
        // The first document establishes the target claim. Every later
        // document is attached to that exact claim through the stricter
        // identity-validation endpoint. This prevents one batch from silently
        // creating/combining Alice and John as separate patients.
        const result = claimId
          ? await ClaimsApi.uploadDoc({
              claimId,
              file
            })
          : await ClaimsApi.smartUploadDoc(file);

        claimId = result?.claim?.id || claimId;

        results.push({
          fileName: file.name,
          ok: true,
          identityStatus:
            result?.identityValidation?.status ||
            (result?.matchStatus === "REVIEW" ? "REVIEW" : "MATCH"),
          message: result?.message || "Document processed",
          confidence:
            result?.document?.confidence ??
            result?.confidence ??
            null,
          type:
            result?.document?.suggestedType ||
            result?.document?.type ||
            result?.suggestedType ||
            result?.type ||
            "OTHER",
          claimId: result?.claim?.id || claimId
        });
      } catch (error) {
        console.error("AI claim creation document failed:", {
          fileName: file.name,
          status: error?.status,
          code: error?.code || null
        });

        results.push({
          fileName: file.name,
          ok: false,
          message: error?.message || "Document could not be processed"
        });

        // A patient mismatch is a high-signal safety issue. Continue to show
        // the remainder of the queue only if the user intentionally retries
        // after reviewing the mismatch; do not attach later files blindly.
        if (error?.code === "DOCUMENT_PATIENT_MISMATCH") {
          break;
        }
      }
    }

    setAiResults(results);
    setAiCreatedClaimId(claimId);
    setAiCreating(false);
    await loadClaims();

    const failed = results.filter((item) => !item.ok);
    const succeeded = results.filter((item) => item.ok);

    if (failed.length === 0 && succeeded.length > 0) {
      showToast(
        succeeded.length === 1
          ? "AI claim creation completed."
          : `AI processed ${succeeded.length} documents successfully.`,
        "success"
      );
    } else if (failed.length > 0) {
      showDialog(
        `${succeeded.length} document(s) processed successfully and ${failed.length} failed. Review the per-document results before continuing.`,
        {
          title: "AI claim creation completed with warnings",
          severity: "warning"
        }
      );
    }
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2, lg: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>Claims</Typography>
          <Typography variant="body2" color="text.secondary">
            Search, review, and progress claims through the revenue cycle.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {[
            ["All", totalClaims, "default"],
            ["Draft", Number(statusSummary.DRAFT || 0), "default"],
            ["Ready", Number(statusSummary.READY || 0), "info"],
            ["Submitted", Number(statusSummary.SUBMITTED || 0) + Number(statusSummary.SUBMITTING || 0), "warning"],
            ["Paid", Number(statusSummary.PAID || 0), "success"]
          ].map(([label, value, color]) => (
            <Chip
              key={label}
              size="small"
              variant={label === "All" ? "filled" : "outlined"}
              color={color}
              label={`${label} ${value}`}
            />
          ))}
        </Stack>
      </Stack>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        mb={3}
        sx={{ flexWrap: "wrap", rowGap: 1, mb: 1.5 }}
      >
        <TextField
          placeholder="Search by Claim ID, patient, payer, member ID, policy number, or amount..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ width: { xs: "100%", sm: 420 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            )
          }}
        />

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => loadClaims()}
        >
          Refresh
        </Button>

        {canCreateFullClaim && (
          <Button
            variant="outlined"
            onClick={() => navigate("/claims/new")}
          >
            New Claim
          </Button>
        )}

        {canImportFromEhr && (
          <Button
            variant="contained"
            startIcon={<CloudDownload />}
            onClick={openEhrImport}
          >
            Create Claim from EHR
          </Button>
        )}

        {canCreateFromDocuments && (
          <Button
            variant="contained"
            startIcon={<AutoAwesome />}
            onClick={openAiCreate}
          >
            Create Claim from Documents
          </Button>
        )}

        {canManageAssignments && selected.length > 0 && (
          <Button
            variant="outlined"
            onClick={() =>
              setAssignmentTarget({
                claimIds: selected,
                currentAssigneeId: "",
                currentTeam: "",
                title: `Assign ${selected.length} selected claim${selected.length === 1 ? "" : "s"}`
              })
            }
          >
            Assign Selected ({selected.length})
          </Button>
        )}

        {/* ✅ BULK DELETE BUTTON */}
        {canDeleteClaims && selected.length > 0 && (
          <Button
            variant="contained"
            color="error"
            onClick={handleBulkDelete}
          >
            Delete Selected ({selected.length})
          </Button>
        )}
      </Stack>

      <Paper sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 1120, tableLayout: "auto" }}>
          <TableHead>
            <TableRow>
              {canSelectClaims && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={handleSelectAll}
                  />
                </TableCell>
              )}

              <TableCell sortDirection={sort === "id" ? direction : false} sx={{ minWidth: 235 }}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "id"} direction={sort === "id" ? direction : "asc"} onClick={() => handleSort("id")}><strong>Claim ID</strong></TableSortLabel></TableCell>
              <TableCell sortDirection={sort === "patientName" ? direction : false}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "patientName"} direction={sort === "patientName" ? direction : "asc"} onClick={() => handleSort("patientName")}><strong>Patient Name</strong></TableSortLabel></TableCell>
              <TableCell sortDirection={sort === "payerName" ? direction : false}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "payerName"} direction={sort === "payerName" ? direction : "asc"} onClick={() => handleSort("payerName")}><strong>Insurance Company</strong></TableSortLabel></TableCell>
              {canViewFinancial && <TableCell sortDirection={sort === "amount" ? direction : false}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "amount"} direction={sort === "amount" ? direction : "desc"} onClick={() => handleSort("amount")}><strong>Amount</strong></TableSortLabel></TableCell>}
              <TableCell sortDirection={sort === "status" ? direction : false}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "status"} direction={sort === "status" ? direction : "asc"} onClick={() => handleSort("status")}><strong>Status</strong></TableSortLabel></TableCell>
              <TableCell sortDirection={sort === "createdAt" ? direction : false}><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "createdAt"} direction={sort === "createdAt" ? direction : "desc"} onClick={() => handleSort("createdAt")}><strong>Created Date</strong></TableSortLabel></TableCell>
              <TableCell><strong>Assignee</strong></TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredClaims.map((claim) => (
              <TableRow key={claim.id}>
                {canSelectClaims && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selected.includes(claim.id)}
                      onChange={() => handleSelectOne(claim.id)}
                    />
                  </TableCell>
                )}

                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Tooltip title={claim.id}>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", fontSize: "0.76rem" }}
                      >
                        {claim.id}
                      </Typography>
                    </Tooltip>
                    <Tooltip title="Copy Claim ID">
                      <IconButton
                        size="small"
                        aria-label={`Copy Claim ID ${claim.id}`}
                        onClick={async () => {
                          try {
                            await window.navigator.clipboard.writeText(claim.id);
                            showToast("Claim ID copied", "success");
                          } catch {
                            showDialog("Unable to copy Claim ID.", {
                              title: "Copy failed",
                              severity: "warning"
                            });
                          }
                        }}
                      >
                        <ContentCopy fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>

                <TableCell>
                  {claim.patientName || "Unknown Patient"}
                </TableCell>

                <TableCell>
                  {claim.payerName || "Insurance"}
                </TableCell>

                {canViewFinancial && (
                  <TableCell>
                    {formatUSD(claim.amount)}
                  </TableCell>
                )}

                <TableCell>
                  <Chip
                    label={humanizeEnum(claim.status, "Draft")}
                    color={statusColor[claim.status] || "default"}
                    size="small"
                  />
                </TableCell>

                <TableCell>
                  {claim.createdAt
                    ? new Date(claim.createdAt).toLocaleDateString()
                    : "-"}
                </TableCell>

                <TableCell sx={{ minWidth: 170 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {claim.assignedToUser?.displayName || claim.assignedToUser?.email || "Unassigned"}
                  </Typography>
                  {claim.workTeam && (
                    <Typography variant="caption" color="text.secondary">
                      {claim.workTeam}
                    </Typography>
                  )}
                </TableCell>

                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {canManageAssignments && (
                    <Button
                      size="small"
                      onClick={() =>
                        setAssignmentTarget({
                          claimIds: [claim.id],
                          currentAssigneeId: claim.assignedToUser?.id || "",
                          currentTeam: claim.workTeam || "",
                          title: `Assign ${claim.patientName || "claim"}`
                        })
                      }
                    >
                      {claim.assignedToUser ? "Reassign" : "Assign"}
                    </Button>
                  )}
                  <IconButton onClick={() => navigate(`/claims/${claim.id}`)}>
                    <Visibility />
                  </IconButton>

                  {canDeleteClaims && (
                    <IconButton
                      color="error"
                      onClick={() => handleDeleteClaim(claim.id)}
                    >
                      <Delete />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {filteredClaims.length === 0 && (
              <TableRow>
                <TableCell colSpan={(canSelectClaims ? 1 : 0) + 7 + (canViewFinancial ? 1 : 0)} align="center">
                  No claims found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <TablePagination
        component="div"
        count={totalClaims}
        page={claimsPage}
        onPageChange={(_, newPage) => setClaimsPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value));
          setClaimsPage(0);
        }}
        rowsPerPageOptions={[10]}
        labelRowsPerPage="Rows per page"
        showFirstButton
        showLastButton
        sx={{ mt: 1 }}
      />

      <ClaimAssignmentDialog
        open={Boolean(assignmentTarget)}
        claimIds={assignmentTarget?.claimIds || []}
        currentAssigneeId={assignmentTarget?.currentAssigneeId || ""}
        currentTeam={assignmentTarget?.currentTeam || ""}
        title={assignmentTarget?.title || "Assign claim"}
        onClose={() => setAssignmentTarget(null)}
        onSaved={async () => {
          setSelected([]);
          await loadClaims();
        }}
      />

      <Dialog
        open={ehrDialogOpen}
        onClose={closeEhrImport}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Create Claim from EHR</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Find the patient in the selected EHR, confirm the correct record, then fetch the
            clinical and billing data needed for the claim. Patient ID is available under
            Advanced Search, but normal users can search by name, DOB, contact details, or MRN.
          </Typography>

          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Active EHR Connection</InputLabel>
              <Select
                label="Active EHR Connection"
                value={ehrConnectionId}
                onChange={(event) => {
                  setEhrConnectionId(event.target.value);
                  setEhrPatientId("");
                  setEhrEncounterId("");
                  setEhrPatientResults([]);
                  setEhrPatientSearchInfo(null);
                  setEhrPreview(null);
                  setEhrResult(null);
                  setEhrCreatedClaimId("");
                }}
                disabled={ehrBusy || !ehrConnections.length}
              >
                {ehrConnections.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name} — {item.provider} ({item.environment})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography fontWeight={800} sx={{ mb: 1 }}>
                Find Patient
              </Typography>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  label="Smart Search"
                  placeholder="Name, email, phone, DOB, id:123, mrn:system|value"
                  value={ehrSearch.smart}
                  onChange={(event) => updateEhrSearch("smart", event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") searchEhrPatients();
                  }}
                  disabled={ehrPatientSearchBusy || ehrBusy}
                  helperText="Examples: Smith, jane@example.com, 5551234567, 1980-01-20, id:12742419"
                />
                <Button
                  variant="contained"
                  startIcon={<SearchIcon />}
                  onClick={searchEhrPatients}
                  disabled={ehrPatientSearchBusy || ehrBusy || !ehrConnectionId}
                  sx={{ minWidth: 120, alignSelf: "flex-start" }}
                >
                  {ehrPatientSearchBusy ? "Searching…" : "Search"}
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setEhrAdvancedSearch((value) => !value)}
                  disabled={ehrPatientSearchBusy || ehrBusy}
                  sx={{ minHeight: 30, px: 1 }}
                >
                  {ehrAdvancedSearch ? "Hide Advanced Search" : "Advanced Search"}
                </Button>

                {selectedEhrConnection()?.environment === "SANDBOX" &&
                  /oracle|cerner/i.test(String(selectedEhrConnection()?.provider || "")) && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setEhrPatientId("12742419");
                        setEhrSelectedPatient({
                          id: "12742419",
                          name: "Oracle billing demo patient",
                          birthDate: null,
                          gender: null,
                          identifiers: []
                        });
                        setEhrEncounterId("97953601");
                        setEhrPatientResults([]);
                        setEhrPatientSearchInfo(null);
                        setEhrPreview(null);
                        setEhrResult(null);
                        setEhrCreatedClaimId("");
                      }}
                      disabled={ehrBusy || ehrPatientSearchBusy}
                      sx={{ minHeight: 30, px: 1 }}
                    >
                      Use Oracle billing demo
                    </Button>
                  )}
              </Stack>

              {ehrAdvancedSearch && (
                <Box
                  sx={{
                    mt: 1,
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                    gap: 1.25
                  }}
                >
                  <TextField
                    size="small"
                    label="Patient / FHIR ID"
                    value={ehrSearch.patientId}
                    onChange={(event) => updateEhrSearch("patientId", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="MRN / Identifier"
                    value={ehrSearch.identifier}
                    onChange={(event) => updateEhrSearch("identifier", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="Identifier System / Assigning Authority"
                    value={ehrSearch.identifierSystem}
                    onChange={(event) => updateEhrSearch("identifierSystem", event.target.value)}
                    helperText="Required for an MRN/identifier search"
                  />
                  <TextField
                    size="small"
                    label="Full / Partial Name"
                    value={ehrSearch.name}
                    onChange={(event) => updateEhrSearch("name", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="Last / Family Name"
                    value={ehrSearch.family}
                    onChange={(event) => updateEhrSearch("family", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="First / Given Name"
                    value={ehrSearch.given}
                    onChange={(event) => updateEhrSearch("given", event.target.value)}
                    helperText="Oracle requires family name with given name"
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="DOB (Exact)"
                    InputLabelProps={{ shrink: true }}
                    value={ehrSearch.birthdate}
                    onChange={(event) => updateEhrSearch("birthdate", event.target.value)}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="DOB From"
                    InputLabelProps={{ shrink: true }}
                    value={ehrSearch.birthdateFrom}
                    onChange={(event) => updateEhrSearch("birthdateFrom", event.target.value)}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="DOB To"
                    InputLabelProps={{ shrink: true }}
                    value={ehrSearch.birthdateTo}
                    onChange={(event) => updateEhrSearch("birthdateTo", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="Phone"
                    value={ehrSearch.phone}
                    onChange={(event) => updateEhrSearch("phone", event.target.value)}
                  />
                  <TextField
                    size="small"
                    type="email"
                    label="Email"
                    value={ehrSearch.email}
                    onChange={(event) => updateEhrSearch("email", event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="Postal Code"
                    value={ehrSearch.postalCode}
                    onChange={(event) => updateEhrSearch("postalCode", event.target.value)}
                  />
                  <FormControl size="small">
                    <InputLabel>Gender</InputLabel>
                    <Select
                      label="Gender"
                      value={ehrSearch.gender}
                      onChange={(event) => updateEhrSearch("gender", event.target.value)}
                    >
                      <MenuItem value="">Any</MenuItem>
                      <MenuItem value="male">Male</MenuItem>
                      <MenuItem value="female">Female</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                      <MenuItem value="unknown">Unknown</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small">
                    <InputLabel>Result Limit</InputLabel>
                    <Select
                      label="Result Limit"
                      value={ehrSearch.count}
                      onChange={(event) => updateEhrSearch("count", Number(event.target.value))}
                    >
                      <MenuItem value={10}>10</MenuItem>
                      <MenuItem value={20}>20</MenuItem>
                      <MenuItem value={50}>50</MenuItem>
                    </Select>
                  </FormControl>

                  <Stack direction="row" spacing={1} alignItems="center">
                    <Checkbox
                      checked={ehrSearch.exactName}
                      onChange={(event) => updateEhrSearch("exactName", event.target.checked)}
                    />
                    <Typography variant="body2">Exact name match</Typography>
                  </Stack>

                  <Button
                    variant="outlined"
                    onClick={() => {
                      setEhrSearch({
                        smart: "",
                        patientId: "",
                        identifier: "",
                        identifierSystem: "",
                        name: "",
                        family: "",
                        given: "",
                        birthdate: "",
                        birthdateFrom: "",
                        birthdateTo: "",
                        phone: "",
                        email: "",
                        postalCode: "",
                        gender: "",
                        exactName: false,
                        count: 20
                      });
                      setEhrPatientResults([]);
                      setEhrPatientSearchInfo(null);
                    }}
                  >
                    Clear Search
                  </Button>
                </Box>
              )}

              {ehrPatientSearchBusy && <LinearProgress sx={{ mt: 1 }} />}

              {ehrPatientSearchInfo && (
                <Alert severity={ehrPatientSearchInfo.severity} sx={{ mt: 1 }}>
                  {ehrPatientSearchInfo.message}
                </Alert>
              )}

              {ehrPatientResults.length > 0 && !ehrSelectedPatient && (
                <Paper variant="outlined" sx={{ mt: 1.25, overflow: "hidden" }}>
                  <Box sx={{ px: 1.25, py: 0.75, bgcolor: "action.hover" }}>
                    <Typography variant="caption" fontWeight={800} color="text.secondary">
                      SEARCH RESULTS
                    </Typography>
                  </Box>
                  <Box sx={{ maxHeight: 230, overflowY: "auto" }}>
                    {ehrPatientResults.map((patient, index) => {
                      const identifier = patient.identifiers?.[0];
                      return (
                        <Box
                          key={patient.id}
                          sx={{
                            px: 1.25,
                            py: 0.9,
                            borderTop: index ? "1px solid" : "none",
                            borderColor: "divider",
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr auto", md: "minmax(180px, 1.2fr) minmax(150px, 1fr) auto" },
                            gap: 1,
                            alignItems: "center"
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={800} noWrap>
                              {patient.name || "Unnamed Patient"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              DOB {patient.birthDate || "—"} • {patient.gender || "—"} • ID {patient.id}
                            </Typography>
                          </Box>

                          <Box sx={{ display: { xs: "none", md: "block" }, minWidth: 0 }}>
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              {identifier
                                ? (identifier.type || "MRN") + ": " + identifier.value
                                : "MRN / Identifier: —"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              {[patient.phones?.[0], patient.emails?.[0]].filter(Boolean).join(" • ") || "Contact: —"}
                            </Typography>
                          </Box>

                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => selectEhrPatient(patient)}
                            sx={{ minWidth: 64, px: 1.25, py: 0.25 }}
                          >
                            Select
                          </Button>
                        </Box>
                      );
                    })}
                  </Box>
                </Paper>
              )}

              {ehrSelectedPatient && (
                <Paper
                  variant="outlined"
                  sx={{ mt: 1.25, p: 1.25, borderColor: "primary.light", bgcolor: "action.hover" }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "stretch", sm: "center" }}
                    spacing={1}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={800}>
                        SELECTED PATIENT
                      </Typography>
                      <Typography variant="body2" fontWeight={800}>
                        {ehrSelectedPatient.name || "Patient"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        EHR ID {ehrPatientId}
                        {ehrSelectedPatient.birthDate ? " • DOB " + ehrSelectedPatient.birthDate : ""}
                        {ehrSelectedPatient.gender ? " • " + ehrSelectedPatient.gender : ""}
                        {ehrEncounterId ? " • Encounter " + ehrEncounterId : ""}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={0.75} flexShrink={0}>
                      <Button
                        size="small"
                        variant="text"
                        onClick={changeEhrPatient}
                        disabled={ehrBusy || ehrEncounterSearchBusy}
                      >
                        Change
                      </Button>
                      {!ehrEncounterId ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={findBillableEncounters}
                          disabled={ehrBusy || ehrEncounterSearchBusy || !ehrConnectionId || !ehrPatientId.trim()}
                          sx={{ minWidth: 138 }}
                        >
                          {ehrEncounterSearchBusy ? "Checking…" : "Find Billable Visits"}
                        </Button>
                      ) : ehrBusy && ehrCancelable ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={cancelEhrFetch}
                          sx={{ minWidth: 112 }}
                        >
                          Cancel Fetch
                        </Button>
                      ) : !ehrPreview ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => fetchEhrClaimData(ehrEncounterId)}
                          disabled={!ehrConnectionId || !ehrPatientId.trim()}
                          sx={{ minWidth: 128 }}
                        >
                          Fetch Claim Data
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Paper>
              )}

              {ehrEncounterSearchBusy && <LinearProgress sx={{ mt: 1 }} />}
              {ehrEncounterInfo && (
                <Alert severity={ehrEncounterInfo.severity} sx={{ mt: 1 }}>
                  {ehrEncounterInfo.message}
                </Alert>
              )}

              {ehrEncounterResults.length > 0 && !ehrPreview && (
                <Paper variant="outlined" sx={{ mt: 1.25, overflow: "hidden" }}>
                  <Box sx={{ px: 1.25, py: 0.75, bgcolor: "action.hover" }}>
                    <Typography variant="caption" fontWeight={800} color="text.secondary">
                      BILLABLE VISITS
                    </Typography>
                  </Box>
                  <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
                    {ehrEncounterResults.map((encounter, index) => (
                      <Box
                        key={encounter.id}
                        sx={{
                          px: 1.25,
                          py: 0.9,
                          borderTop: index ? "1px solid" : "none",
                          borderColor: "divider",
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr auto", md: "1.2fr 1fr 0.7fr auto" },
                          gap: 1,
                          alignItems: "center"
                        }}
                      >
                        <Box>
                          <Typography variant="body2" fontWeight={800}>
                            {encounter.period?.start
                              ? new Date(encounter.period.start).toLocaleDateString()
                              : "Date unavailable"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {encounter.types?.[0] || encounter.classDisplay || encounter.classCode || "Encounter"} • {encounter.id}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
                          {encounter.chargeCount || 0} billable line{encounter.chargeCount === 1 ? "" : "s"}
                        </Typography>
                        <Typography variant="body2" fontWeight={700} sx={{ display: { xs: "none", md: "block" } }}>
                          {encounter.totalBilledAmount ? formatUSD(encounter.totalBilledAmount) : "—"}
                        </Typography>
                        <Button
                          size="small"
                          variant={encounter.billable ? "contained" : "outlined"}
                          disabled={!encounter.billable || ehrBusy}
                          onClick={() => useEncounterForClaim(encounter)}
                          sx={{ minWidth: 88 }}
                        >
                          {encounter.billable ? "Use for Claim" : "No Charges"}
                        </Button>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              )}
            </Paper>

            {ehrBusy && <LinearProgress />}

            {ehrResult && (
              <Alert severity={ehrResult.severity}>
                {ehrResult.message}
              </Alert>
            )}

            {ehrPreview && (
              <Paper variant="outlined" sx={{ p: 1.25 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "stretch", sm: "flex-start" }}
                  spacing={1}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={800}>
                      CLAIM DATA FROM EHR
                    </Typography>
                    <Box
                      sx={{
                        mt: 0.75,
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" },
                        gap: 1
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">Payer</Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {ehrPreview.summary?.payerName || "Not returned"}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Encounter</Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {ehrPreview.summary?.encounterId || "Missing"}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Billable lines</Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {ehrPreview.summary?.chargeCount || 0}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Claim amount</Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {ehrPreview.summary?.totalBilledAmount
                            ? formatUSD(ehrPreview.summary.totalBilledAmount)
                            : "Not available"}
                        </Typography>
                      </Box>
                    </Box>

                    {ehrPreview.missing?.length > 0 && (
                      <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                        Cannot create claim. Missing: {ehrPreview.missing.join(", ")}.
                      </Alert>
                    )}
                    {ehrPreview.warnings?.length > 0 && (
                      <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                        Draft can be created. Complete before submission: {ehrPreview.warnings.join(", ")}.
                      </Alert>
                    )}
                    {!ehrPreview.missing?.length && !ehrPreview.warnings?.length && (
                      <Alert severity="success" sx={{ mt: 1, py: 0 }}>
                        Billing data is sufficient to create a draft claim.
                      </Alert>
                    )}
                  </Box>

                  <Stack spacing={0.75} sx={{ minWidth: { sm: 140 } }}>
                    {ehrBusy && ehrCancelable ? (
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={cancelEhrFetch}
                      >
                        Cancel Fetch
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={fetchEhrClaimData}
                        disabled={ehrBusy}
                      >
                        Refresh
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={createEhrDraftFromPreview}
                      disabled={ehrBusy || !ehrPreview.ready}
                    >
                      {ehrPreview.ready ? "Create Draft" : "Cannot Create"}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={closeEhrImport} disabled={ehrBusy}>Close</Button>
          {ehrCreatedClaimId && (
            <Button
              variant="contained"
              size="small"
              startIcon={<Visibility />}
              onClick={() => navigate(`/claims/${ehrCreatedClaimId}`)}
            >
              Open Claim
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={aiCreateOpen}
        onClose={closeAiCreate}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          Create Claim from Documents
        </DialogTitle>

        <DialogContent>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
            Select the patient documents. PRISM will create one claim and fill the fields it can extract safely.
          </Typography>

          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUpload />}
            disabled={aiCreating}
          >
            Select Documents
            <input
              hidden
              multiple
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={handleAiFiles}
            />
          </Button>

          {aiFiles.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                {aiFiles.length} document{aiFiles.length === 1 ? "" : "s"} selected
              </Typography>
              <Stack spacing={0.4}>
                {aiFiles.slice(0, 5).map((file) => (
                  <Typography key={`${file.name}-${file.size}`} variant="caption" color="text.secondary">
                    {file.name}
                  </Typography>
                ))}
                {aiFiles.length > 5 && (
                  <Typography variant="caption" color="text.secondary">
                    +{aiFiles.length - 5} more
                  </Typography>
                )}
              </Stack>
            </Paper>
          )}

          {aiCreating && (
            <Box sx={{ mt: 3 }}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Processing documents and updating the claim...
              </Typography>
            </Box>
          )}

          {aiResults.length > 0 && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Results
              </Typography>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label="Document processing results">
                  <TableHead>
                    <TableRow>
                      <TableCell>Document</TableCell>
                      <TableCell>Detected Type</TableCell>
                      <TableCell>AI Classification Confidence</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {aiResults.map((result) => (
                      <TableRow key={result.fileName}>
                        <TableCell sx={{ maxWidth: 360 }}>
                          <Stack direction="row" spacing={1} alignItems="flex-start">
                            {result.ok ? (
                              <CheckCircle fontSize="small" color="success" sx={{ mt: 0.25 }} />
                            ) : (
                              <ErrorOutline fontSize="small" color="error" sx={{ mt: 0.25 }} />
                            )}
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={700} noWrap title={result.fileName}>
                                {result.fileName}
                              </Typography>
                              {!result.ok && (
                                <Typography variant="caption" color="error.main">
                                  {result.message}
                                </Typography>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {result.ok ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={String(result.type || "OTHER")
                                .toLowerCase()
                                .split("_")
                                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(" ")}
                            />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {result.ok && result.confidence != null ? (
                            <Typography variant="body2" fontWeight={700}>
                              {result.confidence}%
                            </Typography>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {result.ok ? (
                            <Chip
                              size="small"
                              color={result.identityStatus === "REVIEW" ? "warning" : "success"}
                              variant={result.identityStatus === "REVIEW" ? "outlined" : "filled"}
                              label={result.identityStatus === "REVIEW" ? "Needs review" : "Processed"}
                            />
                          ) : (
                            <Chip size="small" color="error" variant="outlined" label="Failed" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                AI classification confidence reflects how certain the document classifier is about the detected document type. It does not represent coding or clinical accuracy.
              </Typography>

            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={closeAiCreate} disabled={aiCreating}>
            Close
          </Button>

          {aiCreatedClaimId && !aiCreating && (
            <Button
              variant="outlined"
              startIcon={<Visibility />}
              onClick={() => navigate(`/claims/${aiCreatedClaimId}`)}
            >
              Open Claim
            </Button>
          )}

          <Button
            variant="contained"
            startIcon={<AutoAwesome />}
            onClick={createClaimFromDocuments}
            disabled={aiCreating || aiFiles.length === 0 || Boolean(aiCreatedClaimId)}
            data-testid="create-claim-from-documents"
          >
            {aiCreating
              ? "Processing..."
              : aiCreatedClaimId
              ? "Claim Created"
              : "Create Claim"}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}