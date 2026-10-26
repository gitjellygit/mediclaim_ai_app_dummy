import React from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  ArrowForward,
  CheckCircle,
  Close,
  Description,
  Download,
  Edit,
  FactCheck,
  Save,
  Send,
  Refresh,
  UploadFile,
  Visibility
} from "@mui/icons-material";
import { useParams } from "react-router-dom";
import { DenialsApi } from "../../api/denials.js";
import { ClaimsApi } from "../../api/claims.js";
import { AuthApi } from "../../api/auth.js";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { useToast } from "../../context/ToastContext.jsx";
import { formatUSD } from "../../utils/currency.js";

const APPEAL_RATIONALE_MIN_CHARS = 50;

const DOCUMENT_TYPES = [
  "OTHER",
  "FINAL_BILL",
  "PROGRESS_NOTE",
  "OPERATIVE_NOTE",
  "PRIOR_AUTHORIZATION",
  "DISCHARGE_SUMMARY",
  "RADIOLOGY",
  "LAB_REPORT",
  "PRESCRIPTION",
  "INSURANCE_CARD",
  "EOB"
];

const SUBMISSION_CHANNELS = [
  ["PAYER_PORTAL", "Payer Portal"],
  ["CLEARINGHOUSE", "Clearinghouse"],
  ["FAX", "Fax"],
  ["MAIL", "Mail"],
  ["OTHER", "Other"]
];

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-US");
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("en-US");
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not assessed";
}

function signalRevenueRecoveryUpdate() {
  try {
    localStorage.setItem("revenueRecoveryUpdatedAt", String(Date.now()));
  } catch {
    // Cross-tab refresh is best effort; persisted API state remains authoritative.
  }
}

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

export default function AppealWorkspace() {
  const { id } = useParams();
  const user = AuthApi.getUser();
  const canEdit = hasPermission(user, PERMISSIONS.RECOVERY_EDIT);
  const canUploadDocuments = hasPermission(user, PERMISSIONS.DOCUMENT_EDIT);
  const canDownloadDocuments = hasPermission(user, PERMISSIONS.DOCUMENT_DOWNLOAD);
  const canRefreshPayerOutcome = hasPermission(user, PERMISSIONS.PAYER_ACTION);
  const { showToast, showDialog, confirmDialog } = useToast();

  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [action, setAction] = React.useState("");
  const [rationale, setRationale] = React.useState("");
  const [evidenceIds, setEvidenceIds] = React.useState([]);

  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [override, setOverride] = React.useState({
    appealEligible: "",
    correctable: "",
    reason: ""
  });

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState(null);
  const [uploadType, setUploadType] = React.useState("OTHER");

  const [preview, setPreview] = React.useState(null);
  const [packageOpen, setPackageOpen] = React.useState(false);
  const [packageChangedNotice, setPackageChangedNotice] = React.useState(false);

  const [analysisProgressOpen, setAnalysisProgressOpen] = React.useState(false);
  const [analysisProgressState, setAnalysisProgressState] = React.useState("RUNNING");
  const [analysisProgressMessage, setAnalysisProgressMessage] = React.useState("");

  const [eligibilityResult, setEligibilityResult] = React.useState(null);
  const [analysisDetailsOpen, setAnalysisDetailsOpen] = React.useState(false);
  const [payerOutcome, setPayerOutcome] = React.useState(null);

  const effectivePayerStatus = String(
    payerOutcome?.payerClaimStatus || data?.claim?.payerClaimStatus || ""
  ).toUpperCase();
  const effectiveRemittanceStatus = String(
    payerOutcome?.remittanceStatus || data?.claim?.remittanceStatus || ""
  ).toUpperCase();
  const effectivePaidAmount = Number(
    payerOutcome?.paidAmount ?? data?.claim?.paidAmount ?? 0
  );
  const payerOutcomeFinal =
    effectivePayerStatus === "PAID" &&
    effectiveRemittanceStatus === "POSTED";
  const displayedRecoveredAmount = Math.max(
    Number(data?.recoveredAmount || 0),
    payerOutcomeFinal ? effectivePaidAmount : 0
  );
  const remainingRecoveryAmount = Math.max(
    0,
    Number(data?.revenueAtRisk || 0) - displayedRecoveredAmount
  );

  const [submissionOpen, setSubmissionOpen] = React.useState(false);
  const [submission, setSubmission] = React.useState({
    channel: "PAYER_PORTAL",
    reference: "",
    date: todayInputValue()
  });

  const load = React.useCallback(async ({ preserveDraft = false } = {}) => {
    setLoading(true);
    try {
      const result = await DenialsApi.getAppealWorkspace(id);
      setData(result);
      setPayerOutcome({
        payerClaimStatus: result.claim?.payerClaimStatus || null,
        claimStatusCheckedAt: result.claim?.claimStatusCheckedAt || null,
        remittanceStatus: result.claim?.remittanceStatus || "NOT_AVAILABLE",
        remittanceReceivedAt: result.claim?.remittanceReceivedAt || null,
        paidAmount: result.claim?.paidAmount ?? null,
        paymentReference: result.claim?.paymentReference || null,
        message: null
      });
      if (!preserveDraft) {
        setRationale(result.appealRationale || "");
        setEvidenceIds(result.appealEvidenceDocumentIds || []);
      }
      setSubmission({
        channel: result.appealSubmissionChannel || "PAYER_PORTAL",
        reference: result.appealSubmissionReference || "",
        date: result.appealExternalSubmittedAt
          ? new Date(result.appealExternalSubmittedAt).toISOString().slice(0, 10)
          : todayInputValue()
      });
    } catch (error) {
      showDialog(error?.message || "Unable to load the appeal workspace.", {
        title: "Appeal workspace unavailable",
        severity: "error"
      });
    } finally {
      setLoading(false);
    }
  }, [id, showDialog]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  async function runAnalysis() {
    const startedAt = Date.now();
    setAction("analysis");
    setAnalysisProgressState("RUNNING");
    setAnalysisProgressMessage(
      "Reviewing payer denial codes, claim facts, and the current recovery evidence."
    );
    setAnalysisProgressOpen(true);

    try {
      const result = await DenialsApi.analyze(id);
      await load({ preserveDraft: true });

      const elapsed = Date.now() - startedAt;
      if (elapsed < 700) {
        await new Promise((resolve) => window.setTimeout(resolve, 700 - elapsed));
      }

      setAnalysisProgressState("COMPLETE");
      setAnalysisProgressMessage(
        result?.ai?.llmUsed
          ? "Analysis completed using the approved external AI configuration."
          : "Analysis completed using Recovery Rules. No claim information was sent to an external AI service."
      );

      await new Promise((resolve) => window.setTimeout(resolve, 900));
      setAnalysisProgressOpen(false);
    } catch (error) {
      setAnalysisProgressOpen(false);
      showDialog(error?.message || "Recovery analysis could not be completed.", {
        title: "Analysis failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function recheckEligibility() {
    setAction("eligibility-recheck");
    try {
      const result = await DenialsApi.recheckEligibility(id);
      setEligibilityResult(result);
      showToast(
        result?.supportsAppeal
          ? "Eligibility reconciliation supports the appeal"
          : "Eligibility reconciliation completed",
        result?.supportsAppeal ? "success" : "info"
      );
    } catch (error) {
      showDialog(error?.message || "Eligibility could not be re-checked for this appeal.", {
        title: "Eligibility reconciliation failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function saveRationale() {
    const trimmed = rationale.trim();
    if (trimmed.length < APPEAL_RATIONALE_MIN_CHARS) {
      showDialog(
        `Enter at least ${APPEAL_RATIONALE_MIN_CHARS} characters before saving the appeal rationale.`,
        { title: "Rationale is too short", severity: "warning" }
      );
      return;
    }

    const wasPrepared = data?.status === "APPEAL_PREPARED";
    setAction("save-rationale");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale: trimmed,
        evidenceDocumentIds: evidenceIds
      });
      await load();
      if (wasPrepared) setPackageChangedNotice(true);
      signalRevenueRecoveryUpdate();
      showToast("Appeal rationale and evidence selection saved", "success");
    } catch (error) {
      showDialog(error?.message || "Appeal rationale could not be saved.", {
        title: "Save failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function clearRationale() {
    const ok = await confirmDialog(
      "Clear the appeal rationale? This will remove the saved rationale and the case will no longer be ready to prepare until a new valid rationale is saved.",
      {
        title: "Clear appeal rationale?",
        severity: "warning",
        confirmLabel: "Clear Rationale",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    const wasPrepared = data?.status === "APPEAL_PREPARED";
    setAction("clear-rationale");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale: "",
        evidenceDocumentIds: evidenceIds
      });
      await load();
      if (wasPrepared) setPackageChangedNotice(true);
      signalRevenueRecoveryUpdate();
      showToast("Appeal rationale cleared", "info");
    } catch (error) {
      showDialog(error?.message || "Appeal rationale could not be cleared.", {
        title: "Clear failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function prepareAppeal() {
    const selectedCount = evidenceIds.length;
    const ok = await confirmDialog(
      `${packageChangedNotice ? "Review and re-prepare" : "Review and prepare"} this appeal with ${selectedCount} selected evidence document${selectedCount === 1 ? "" : "s"}? This confirms that the exact rationale and evidence package has been reviewed and is ready for submission.`,
      {
        title: "Prepare appeal?",
        severity: "warning",
        confirmLabel: "Prepare Appeal",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    setAction("prepare");
    try {
      await DenialsApi.prepareAppeal(id);
      await load();
      setPackageChangedNotice(false);
      signalRevenueRecoveryUpdate();
      showToast("Appeal prepared and ready for submission review", "success");
    } catch (error) {
      showDialog(error?.message || "Appeal could not be prepared.", {
        title: "Prepare appeal failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function confirmSubmission() {
    if (!submission.channel || !submission.date) {
      showDialog("Submission channel and submission date are required.", {
        title: "Submission details required",
        severity: "warning"
      });
      return;
    }

    if (submission.date > todayInputValue()) {
      showDialog("Submission date cannot be in the future.", {
        title: "Invalid submission date",
        severity: "warning"
      });
      return;
    }

    // Never stack the global confirmation dialog on top of the submission
    // details modal. MUI traps focus in the first modal, which can make the
    // confirmation inaccessible to keyboard users and automated browsers.
    setSubmissionOpen(false);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const ok = await confirmDialog(
      "Are you sure this appeal has already been submitted through the selected external channel? PRISM will record the submission and lock the appeal for editing. PRISM itself will not transmit anything to the payer.",
      {
        title: "Record external submission?",
        severity: "warning",
        confirmLabel: "Yes, Record Submission",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) {
      setSubmissionOpen(true);
      return;
    }

    setAction("submit");
    try {
      const result = await DenialsApi.markAppealSubmitted(id, {
        confirmed: true,
        submissionChannel: submission.channel,
        submissionReference: submission.reference,
        submissionDate: submission.date
      });
      await load();
      signalRevenueRecoveryUpdate();
      showToast(
        result?.transmission?.note ||
          "Appeal submission recorded successfully.",
        "success"
      );
    } catch (error) {
      showDialog(error?.message || "Appeal could not be marked submitted.", {
        title: "Submission status update failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function refreshPayerOutcome() {
    if (!data?.claimId || action) return;
    setAction("payer-outcome");

    let message = "";
    try {
      let journey = await ClaimsApi.getJourney(data.claimId);
      const mode = String(journey?.payerConnection?.mode || "").toUpperCase();

      try {
        if (mode === "SIMULATED") {
          await ClaimsApi.simulatePayerStatus(data.claimId);
        } else if (mode === "LIVE" && journey?.stages?.claimStatus?.actionable) {
          await ClaimsApi.refreshPayerStatus(data.claimId);
        }
      } catch (error) {
        message = error?.message || "Payer claim status could not be refreshed.";
      }

      journey = await ClaimsApi.getJourney(data.claimId);

      try {
        const remittanceActionable = journey?.stages?.remittance?.actionable;
        if (mode === "SIMULATED" && remittanceActionable) {
          await ClaimsApi.simulatePayerRemittance(data.claimId);
          journey = await ClaimsApi.getJourney(data.claimId);
        } else if (
          mode === "LIVE" &&
          remittanceActionable &&
          hasPermission(user, PERMISSIONS.FINANCIAL_VIEW)
        ) {
          await ClaimsApi.refreshRemittance(data.claimId);
          journey = await ClaimsApi.getJourney(data.claimId);
        }
      } catch (error) {
        if (!message) message = error?.message || "Remittance is not available yet.";
      }

      setPayerOutcome({
        payerClaimStatus: journey?.stages?.claimStatus?.status || null,
        claimStatusCheckedAt: journey?.stages?.claimStatus?.checkedAt || null,
        remittanceStatus: journey?.stages?.remittance?.status || "NOT_AVAILABLE",
        remittanceReceivedAt: journey?.stages?.remittance?.receivedAt || null,
        paidAmount: journey?.stages?.remittance?.paidAmount ?? null,
        paymentReference: journey?.stages?.remittance?.paymentReference || null,
        message:
          message ||
          (mode === "LOCAL"
            ? "Showing the latest recorded payer outcome. No live payer status connector is configured."
            : "Payer outcome refreshed.")
      });
      await load({ preserveDraft: true });
    } catch (error) {
      showDialog(error?.message || "Payer outcome could not be refreshed.", {
        title: "Outcome refresh failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function saveOverride() {
    const payload = { reason: override.reason };
    if (override.appealEligible !== "") {
      payload.appealEligible = override.appealEligible === "YES";
    }
    if (override.correctable !== "") {
      payload.correctable = override.correctable === "YES";
    }

    const ok = await confirmDialog(
      "Are you sure you want to override the system recovery assessment? This change is audited and may change whether the case can move into appeal preparation.",
      {
        title: "Confirm assessment override",
        severity: "warning",
        confirmLabel: "Confirm Override",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    setAction("override");
    try {
      await DenialsApi.overrideAssessment(id, payload);
      setOverrideOpen(false);
      setOverride({ appealEligible: "", correctable: "", reason: "" });
      await load();
      signalRevenueRecoveryUpdate();
      showToast("Recovery assessment override recorded", "success");
    } catch (error) {
      showDialog(error?.message || "Assessment override could not be saved.", {
        title: "Override failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function uploadEvidence() {
    if (!uploadFile) {
      showDialog("Choose a file to upload.", {
        title: "File required",
        severity: "warning"
      });
      return;
    }

    const wasPrepared = data?.status === "APPEAL_PREPARED";
    setAction("upload");
    try {
      const result = await DenialsApi.uploadAppealEvidence(id, {
        file: uploadFile,
        type: uploadType
      });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadType("OTHER");
      await load({ preserveDraft: true });
      if (result?.document?.id) {
        setEvidenceIds((current) => [...new Set([...current, result.document.id])]);
      }
      if (wasPrepared) setPackageChangedNotice(true);
      signalRevenueRecoveryUpdate();
      showToast("Supporting evidence uploaded and added to this appeal", "success");
    } catch (error) {
      showDialog(error?.message || "Supporting evidence could not be uploaded.", {
        title: "Upload failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function viewDocument(doc) {
    setAction(`preview:${doc.id}`);
    try {
      const blob = await DenialsApi.previewDocument(doc.id);
      const url = URL.createObjectURL(blob);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({ doc, url });
    } catch (error) {
      showDialog(error?.message || "Document preview could not be loaded.", {
        title: "Preview unavailable",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function downloadDocument(doc) {
    setAction(`download:${doc.id}`);
    try {
      const blob = await DenialsApi.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.fileName || "appeal-evidence";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showDialog(error?.message || "Document could not be downloaded.", {
        title: "Download failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function toggleEvidence(documentId) {
    if (!editable || action) return;

    const wasPrepared = data?.status === "APPEAL_PREPARED";
    const previous = [...evidenceIds];
    const next = previous.includes(documentId)
      ? previous.filter((idValue) => idValue !== documentId)
      : [...previous, documentId];

    setEvidenceIds(next);
    setAction(`evidence:${documentId}`);

    try {
      const savedRationale = String(data?.appealRationale || "").trim();
      const updated = await DenialsApi.saveAppealDraft(id, {
        rationale: savedRationale,
        evidenceDocumentIds: next
      });

      setData((current) =>
        current
          ? {
              ...current,
              ...updated,
              appealEvidenceDocumentIds: next
            }
          : current
      );
      if (wasPrepared) setPackageChangedNotice(true);
      signalRevenueRecoveryUpdate();
    } catch (error) {
      setEvidenceIds(previous);
      showDialog(error?.message || "Evidence selection could not be saved.", {
        title: "Evidence update failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function useRecommendedEvidence() {
    if (!editable || action) return;

    const recommendedTypes = new Set(
      (Array.isArray(data?.requiredDocuments) ? data.requiredDocuments : [])
        .map((item) => String(item || "").toUpperCase())
    );
    const recommendedIds = documents
      .filter((doc) => recommendedTypes.has(String(doc.type || "").toUpperCase()))
      .map((doc) => doc.id);

    if (recommendedIds.length === 0) {
      showDialog(
        "None of the currently available claim documents match the evidence recommended by the recovery analysis. Upload the missing evidence or select another relevant document.",
        { title: "Recommended evidence is missing", severity: "info" }
      );
      return;
    }

    const next = [...new Set([...evidenceIds, ...recommendedIds])];
    if (next.length === evidenceIds.length) return;
    setAction("recommended-evidence");
    try {
      const updated = await DenialsApi.saveAppealDraft(id, {
        rationale: String(data?.appealRationale || "").trim(),
        evidenceDocumentIds: next
      });
      setEvidenceIds(next);
      setData((current) =>
        current
          ? { ...current, ...updated, appealEvidenceDocumentIds: next }
          : current
      );
      if (data?.status === "APPEAL_PREPARED") setPackageChangedNotice(true);
      signalRevenueRecoveryUpdate();
      showToast("Recommended available evidence added to the appeal", "success");
    } catch (error) {
      showDialog(error?.message || "Recommended evidence could not be selected.", {
        title: "Evidence update failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  if (loading) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data) return null;

  const submitted = ["APPEAL_SUBMITTED", "OVERTURNED", "UPHELD", "CLOSED"].includes(data.status);
  const editable = canEdit && !submitted;
  const canUpload = editable && canUploadDocuments;
  const documents = data.claim?.documents || [];
  const selectedDocs = new Set(evidenceIds);
  const selectedDocumentRows = documents.filter((doc) => selectedDocs.has(doc.id));
  const rationaleTrimmed = rationale.trim();
  const savedRationale = String(data.appealRationale || "").trim();
  const rationaleLengthValid = rationaleTrimmed.length >= APPEAL_RATIONALE_MIN_CHARS;
  const rationaleSaved =
    rationaleLengthValid &&
    savedRationale.length >= APPEAL_RATIONALE_MIN_CHARS &&
    rationaleTrimmed === savedRationale;
  const savedEvidenceIds = Array.isArray(data.appealEvidenceDocumentIds)
    ? data.appealEvidenceDocumentIds
    : [];
  const evidenceSaved =
    [...evidenceIds].sort().join("|") === [...savedEvidenceIds].sort().join("|");
  const draftSaved = rationaleSaved && evidenceSaved;
  const hasDraftChanges = !rationaleSaved || !evidenceSaved;
  const suggestedEvidenceMissing =
    Array.isArray(data.requiredDocuments) &&
    data.requiredDocuments.length > 0 &&
    evidenceIds.length === 0;

  const eligibilityDenial =
    String(data.denialCategory || "").toUpperCase() === "ELIGIBILITY";
  const recommendedTypes = new Set(
    (Array.isArray(data.requiredDocuments) ? data.requiredDocuments : [])
      .map((item) => String(item || "").toUpperCase())
  );
  const recommendedDocuments = documents.filter((doc) =>
    recommendedTypes.has(String(doc.type || "").toUpperCase())
  );
  const recommendedAvailableIds = recommendedDocuments.map((doc) => doc.id);
  const recommendedEvidenceAlreadySelected =
    recommendedAvailableIds.length > 0 &&
    recommendedAvailableIds.every((documentId) => selectedDocs.has(documentId));
  const missingRecommendedTypes = [...recommendedTypes].filter(
    (type) => !documents.some((doc) => String(doc.type || "").toUpperCase() === type)
  );
  const issueResolved = !eligibilityDenial || Boolean(eligibilityResult);
  const packageComplete = Boolean(data.aiAnalyzedAt) && issueResolved && draftSaved;
  const reviewComplete = Boolean(data.appealPreparedAt) && !packageChangedNotice;
  const submissionRecorded = Boolean(data.appealSubmittedAt);
  const workflowSteps = [
    { label: "Analyze Denial", complete: Boolean(data.aiAnalyzedAt) },
    { label: "Resolve Denial Issue", complete: issueResolved && Boolean(data.aiAnalyzedAt) },
    { label: "Build Appeal Package", complete: packageComplete },
    { label: "Review Package", complete: reviewComplete },
    { label: "Record Submission", complete: submissionRecorded }
  ];
  const activeStep = submissionRecorded
    ? 5
    : reviewComplete
    ? 5
    : packageComplete
    ? 4
    : data.aiAnalyzedAt && issueResolved
    ? 3
    : data.aiAnalyzedAt
    ? 2
    : 1;

  return (
    <Box sx={{ py: 1.5, maxWidth: 1500, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 1.25 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>Appeal Workspace</Typography>
          <Typography variant="body2" color="text.secondary">
            {data.claim?.patientName || "—"} · {data.claim?.payerName || "—"} · {data.claim?.insurerClaimNo || data.claimId}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Chip
            size="small"
            label={String(data.status || "").replaceAll("_", " ")}
            color={submitted ? "success" : "warning"}
            variant="outlined"
          />
          <Button variant="outlined" size="small" startIcon={<Close />} onClick={() => window.close()}>
            Close
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ px: 1.25, py: 1, mb: 1.25 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(5, minmax(0,1fr))" }, gap: 0.5 }}>
          {workflowSteps.map((step, index) => {
            const number = index + 1;
            const active = activeStep === number && !step.complete;
            return (
              <Box
                key={step.label}
                data-testid={`appeal-step-${number}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1,
                  py: 0.7,
                  borderRadius: 1,
                  bgcolor: active ? "rgba(23,59,87,0.08)" : "transparent",
                  border: "1px solid",
                  borderColor: active ? "primary.light" : "transparent"
                }}
              >
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    bgcolor: step.complete ? "success.main" : active ? "primary.main" : "grey.200",
                    color: step.complete || active ? "#fff" : "text.secondary"
                  }}
                >
                  {step.complete ? "✓" : number}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={active || step.complete ? 750 : 600} noWrap>
                    {step.label}
                  </Typography>
                  <Typography variant="caption" color={step.complete ? "success.main" : active ? "primary.main" : "text.secondary"}>
                    {step.complete ? "Complete" : active ? "In progress" : "Pending"}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Paper>

      {submitted && (
        <Alert severity="success" sx={{ mb: 1.25 }}>
          This appeal is recorded as submitted/finalized and is read-only. Continue payer outcome tracking from Revenue Recovery.
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 2.35fr) minmax(280px, 0.8fr)" }, gap: 1.25 }}>
        <Stack spacing={1.25}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
              <Box>
                <Typography variant="subtitle1" fontWeight={800}>
                  {eligibilityDenial ? "Eligibility / Coverage Denial" : (data.denialCategory || "Denial Review")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {[data.carcCode, data.rarcCode].filter(Boolean).join(" / ") || "No CARC/RARC recorded"}
                  {data.reasonText ? ` · ${data.reasonText}` : ""}
                </Typography>
              </Box>
              <Box sx={{ textAlign: { xs: "left", md: "right" } }}>
                <Typography variant="caption" color="text.secondary">Amount at risk</Typography>
                <Typography variant="h5" fontWeight={850} color="error.main">{formatUSD(data.revenueAtRisk)}</Typography>
              </Box>
            </Stack>

            {!data.aiAnalyzedAt ? (
              <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" spacing={1} sx={{ mt: 1.25 }}>
                <Typography variant="body2">Run recovery analysis to classify the denial and determine the recommended recovery path.</Typography>
                <Button variant="contained" size="small" startIcon={<FactCheck />} onClick={runAnalysis} disabled={Boolean(action)}>
                  {action === "analysis" ? "Analyzing..." : "Analyze Denial"}
                </Button>
              </Stack>
            ) : (
              <Box sx={{ mt: 1.25 }}>
                <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
                  <b>PRISM recommendation:</b> {data.recommendedAction || "Review this denial and supporting claim evidence."}
                </Alert>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Button size="small" sx={{ px: 0 }} onClick={() => setAnalysisDetailsOpen((value) => !value)}>
                    {analysisDetailsOpen ? "Hide analysis details" : "View analysis details"}
                  </Button>
                  {editable && (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<FactCheck />}
                      onClick={runAnalysis}
                      disabled={Boolean(action)}
                    >
                      {action === "analysis" ? "Analyzing..." : "Re-run analysis"}
                    </Button>
                  )}
                </Stack>
                {analysisDetailsOpen && (
                  <Box sx={{ mt: 0.5, p: 1, bgcolor: "grey.50", borderRadius: 1 }}>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 0.75 }}>
                      <Chip size="small" label={data.aiProvider === "OPENAI" ? "Approved External AI" : "Recovery Rules"} />
                      <Chip size="small" label={`${data.aiConfidence ?? "—"}% confidence`} variant="outlined" />
                      <Chip size="small" label={`Appeal eligible: ${yesNo(data.appealEligible)}`} color={data.appealEligible ? "success" : "default"} variant="outlined" />
                    </Stack>
                    <Typography variant="body2">{data.aiExplanation || "No additional analysis detail."}</Typography>
                  </Box>
                )}
              </Box>
            )}
          </Paper>

          {data.aiAnalyzedAt && eligibilityDenial && (
            <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="eligibility-reconciliation">
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.25}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>Step 2 · Resolve Denial Issue</Typography>
                  <Typography variant="body2" color="text.secondary">
                    The payer denied eligibility even though PRISM previously recorded eligibility as {String(data.claim?.eligibilityStatus || "not verified").replaceAll("_", " ")}.
                    Reconcile coverage for the date of service without changing the submitted claim.
                  </Typography>
                </Box>
                <Button
                  variant={eligibilityResult ? "outlined" : "contained"}
                  size="small"
                  onClick={recheckEligibility}
                  disabled={!editable || Boolean(action)}
                >
                  {action === "eligibility-recheck" ? "Checking..." : eligibilityResult ? "Run Again" : "Re-check Eligibility"}
                </Button>
              </Stack>

              <Box sx={{ mt: 1.25, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr auto 1fr" }, gap: 1, alignItems: "stretch" }}>
                <Box sx={{ p: 1, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Previous recorded eligibility</Typography>
                  <Typography variant="body2" fontWeight={750}>{String(data.claim?.eligibilityStatus || "NOT CHECKED").replaceAll("_", " ")}</Typography>
                  <Typography variant="caption" color="text.secondary">DOS: {formatDate(data.claim?.dateOfService)}</Typography>
                </Box>
                <Box sx={{ display: { xs: "none", md: "grid" }, placeItems: "center", color: "text.secondary" }}>→</Box>
                <Box sx={{ p: 1, bgcolor: eligibilityResult?.supportsAppeal ? "rgba(47,125,91,0.07)" : "grey.50", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Appeal reconciliation result</Typography>
                  <Typography variant="body2" fontWeight={750} color={eligibilityResult?.supportsAppeal ? "success.main" : "text.primary"}>
                    {eligibilityResult ? String(eligibilityResult.coverageStatus || eligibilityResult.status).replaceAll("_", " ") : "Not run yet"}
                  </Typography>
                  {eligibilityResult && (
                    <Typography variant="caption" color="text.secondary">
                      {eligibilityResult.livePayerVerification ? "Live payer response" : "Configured payer connector response"} · {formatDateTime(eligibilityResult.checkedAt)}
                    </Typography>
                  )}
                </Box>
              </Box>

              {eligibilityResult && (
                <Alert severity={eligibilityResult.supportsAppeal ? "success" : "warning"} sx={{ mt: 1 }}>
                  {eligibilityResult.supportsAppeal
                    ? "Coverage is active for the date of service. This supports the appeal."
                    : "Coverage was not confirmed active. Review the payer response and recovery strategy before continuing."}
                  {" "}This check is read-only and does not resubmit or alter the claim.
                </Alert>
              )}
            </Paper>
          )}

          {data.aiAnalyzedAt && issueResolved && (
            <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="appeal-package-builder">
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>Step 3 · Build Appeal Package</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select evidence and save the factual appeal rationale. Only checked documents are included.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={useRecommendedEvidence}
                    disabled={
                      !editable ||
                      Boolean(action) ||
                      recommendedAvailableIds.length === 0 ||
                      recommendedEvidenceAlreadySelected
                    }
                  >
                    {recommendedEvidenceAlreadySelected ? "Recommended Evidence Added" : "Use Recommended Evidence"}
                  </Button>
                  {canUpload && (
                    <Button size="small" variant="outlined" startIcon={<UploadFile />} onClick={() => setUploadOpen(true)} disabled={Boolean(action)}>
                      Upload
                    </Button>
                  )}
                </Stack>
              </Stack>

              {missingRecommendedTypes.length > 0 && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Missing recommended evidence: {missingRecommendedTypes.map((item) => item.replaceAll("_", " ")).join(", ")}
                </Alert>
              )}

              <Box sx={{ mt: 1.25, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.05fr 1fr" }, gap: 1.25 }}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                    <Typography variant="subtitle2" fontWeight={800}>Evidence</Typography>
                    <Typography variant="caption" color="text.secondary">{evidenceIds.length} selected</Typography>
                  </Stack>
                  <Stack spacing={0.5}>
                    {documents.length === 0 ? (
                      <Alert severity="warning">No claim documents are available.</Alert>
                    ) : documents.map((doc) => {
                      const recommended = recommendedTypes.has(String(doc.type || "").toUpperCase());
                      return (
                        <Box
                          key={doc.id}
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "auto minmax(0,1fr) auto",
                            alignItems: "center",
                            gap: 0.6,
                            px: 0.75,
                            py: 0.45,
                            border: "1px solid",
                            borderColor: selectedDocs.has(doc.id) ? "primary.light" : "divider",
                            borderRadius: 1,
                            bgcolor: selectedDocs.has(doc.id) ? "rgba(23,59,87,0.035)" : "background.paper"
                          }}
                        >
                          <Checkbox
                            size="small"
                            checked={selectedDocs.has(doc.id)}
                            disabled={!editable || Boolean(action)}
                            onChange={() => toggleEvidence(doc.id)}
                            sx={{ p: 0.25 }}
                          />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700} noWrap>{doc.fileName}</Typography>
                            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                              <Typography variant="caption" color="text.secondary">{String(doc.type).replaceAll("_", " ")}</Typography>
                              <Chip
                                size="small"
                                label={recommended ? "Recommended" : "Optional"}
                                color={recommended ? "info" : "default"}
                                variant="outlined"
                              />
                            </Stack>
                          </Box>
                          <Stack direction="row" spacing={0.25}>
                            <IconButton size="small" onClick={() => viewDocument(doc)} disabled={Boolean(action)} aria-label={`View ${doc.fileName}`}>
                              <Visibility fontSize="small" />
                            </IconButton>
                            {canDownloadDocuments && (
                              <IconButton size="small" onClick={() => downloadDocument(doc)} disabled={Boolean(action)} aria-label={`Download ${doc.fileName}`}>
                                <Download fontSize="small" />
                              </IconButton>
                            )}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                    <Typography variant="subtitle2" fontWeight={800}>Appeal Rationale</Typography>
                    <Typography variant="caption" color="text.secondary">{rationale.length}/5000</Typography>
                  </Stack>
                  <TextField
                    fullWidth
                    multiline
                    minRows={8}
                    value={rationale}
                    disabled={!editable}
                    onChange={(event) => setRationale(event.target.value)}
                    placeholder="Explain the factual basis for the appeal using the denial reason, claim facts, and selected evidence."
                    inputProps={{ maxLength: 5000 }}
                    error={Boolean(rationaleTrimmed) && !rationaleLengthValid}
                    helperText={
                      rationaleSaved
                        ? "Saved and ready."
                        : rationaleLengthValid
                        ? "Minimum met. Save to complete the package."
                        : `${Math.max(0, APPEAL_RATIONALE_MIN_CHARS - rationaleTrimmed.length)} more characters required.`
                    }
                  />
                  <Stack direction="row" justifyContent="flex-end" spacing={0.75} sx={{ mt: 0.75 }}>
                    <Button size="small" color="inherit" disabled={!editable || Boolean(action) || (!rationale && !savedRationale)} onClick={clearRationale}>
                      Clear
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<Save />}
                      disabled={!editable || Boolean(action) || !rationaleLengthValid || rationaleSaved}
                      onClick={saveRationale}
                    >
                      {action === "save-rationale" ? "Saving..." : "Save Rationale"}
                    </Button>
                  </Stack>
                </Box>
              </Box>

              <Divider sx={{ my: 1.25 }} />
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} spacing={1}>
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                  <Chip size="small" icon={data.aiAnalyzedAt ? <CheckCircle /> : undefined} label="Analysis" color={data.aiAnalyzedAt ? "success" : "default"} variant="outlined" />
                  <Chip size="small" icon={issueResolved ? <CheckCircle /> : undefined} label="Issue reviewed" color={issueResolved ? "success" : "default"} variant="outlined" />
                  <Chip size="small" icon={rationaleSaved ? <CheckCircle /> : undefined} label="Rationale saved" color={rationaleSaved ? "success" : "default"} variant="outlined" />
                  <Chip size="small" icon={evidenceSaved ? <CheckCircle /> : undefined} label={`${evidenceIds.length} evidence selected`} color={evidenceSaved ? "success" : "default"} variant="outlined" />
                </Stack>
                <Stack alignItems={{ xs: "stretch", md: "flex-end" }} spacing={0.25}>
                  <Button
                    size="small"
                    variant="contained"
                    endIcon={<ArrowForward />}
                    disabled={!editable || Boolean(action) || !packageComplete}
                    onClick={() => setPackageOpen(true)}
                  >
                    Review Package
                  </Button>
                  {!rationaleSaved && (
                    <Typography variant="caption" color="text.secondary">
                      Save a valid appeal rationale before package review.
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Paper>
          )}

          {packageComplete && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} spacing={1}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>Step 4 · Review Package</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Preview the exact rationale and selected evidence before approving the package.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75}>
                  <Button size="small" variant="outlined" startIcon={<Description />} onClick={() => setPackageOpen(true)}>
                    Preview
                  </Button>
                  {!reviewComplete && !submitted && (
                    <Button size="small" variant="contained" onClick={prepareAppeal} disabled={!editable || Boolean(action)}>
                      {action === "prepare" ? "Preparing..." : packageChangedNotice ? "Re-approve Package" : "Approve Package"}
                    </Button>
                  )}
                </Stack>
              </Stack>
              {packageChangedNotice && (
                <Alert severity="warning" sx={{ mt: 1 }} data-testid="appeal-package-changed">
                  The package changed after review. Preview and approve it again before recording submission.
                </Alert>
              )}
            </Paper>
          )}

          {reviewComplete && !submitted && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} spacing={1}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>Step 5 · Record External Submission</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Submit through the payer-approved external channel first. Then record the channel, date, and confirmation here.
                  </Typography>
                </Box>
                <Button color="success" variant="contained" size="small" startIcon={<Send />} onClick={() => setSubmissionOpen(true)} disabled={!canEdit || Boolean(action)}>
                  Record External Submission
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>

        <Stack spacing={1.25}>
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2" fontWeight={800}>Claim Summary</Typography>
              <Chip size="small" label={data.denialCategory || "DENIAL"} color="error" variant="outlined" />
            </Stack>
            <Stack spacing={0.65} sx={{ mt: 1 }}>
              {[
                ["Patient", data.claim?.patientName || "—"],
                ["Payer", data.claim?.payerName || "—"],
                ["Claim #", data.claim?.insurerClaimNo || data.claimId || "—"],
                ["Date of Service", formatDate(data.claim?.dateOfService)],
                ["Claim Form", data.claim?.claimForm || "—"],
                ["Appeal Deadline", formatDate(data.appealDeadline)]
              ].map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" fontWeight={650} textAlign="right">{value}</Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Recovery Summary</Typography>
            <Box sx={{ mt: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">At risk</Typography>
                <Typography variant="h6" fontWeight={850}>{formatUSD(data.revenueAtRisk)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Recovered</Typography>
                <Typography variant="h6" fontWeight={850} color="success.main">{formatUSD(displayedRecoveredAmount)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Remaining</Typography>
                <Typography variant="h6" fontWeight={850}>{formatUSD(remainingRecoveryAmount)}</Typography>
              </Box>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Recovery Assessment</Typography>
            <Stack spacing={0.6} sx={{ mt: 0.75 }}>
              <Chip
                size="small"
                label={`Appeal Eligible: ${yesNo(data.appealEligible)}`}
                color={data.appealEligible === true ? "success" : data.appealEligible === false ? "error" : "default"}
                variant="outlined"
              />
              <Chip
                size="small"
                label={`Correctable: ${yesNo(data.correctable)}`}
                variant="outlined"
              />
              {data.assessmentOverriddenAt && (
                <Typography variant="caption" color="warning.main">
                  Assessment overridden {formatDate(data.assessmentOverriddenAt)}
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Next Action</Typography>
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {!data.aiAnalyzedAt
                ? "Analyze the denial."
                : eligibilityDenial && !eligibilityResult
                ? "Re-check eligibility for the date of service."
                : !packageComplete
                ? "Build and save the appeal package."
                : !reviewComplete
                ? "Preview and approve the appeal package."
                : !submissionRecorded
                ? "Submit externally and record the submission."
                : payerOutcomeFinal
                ? remainingRecoveryAmount > 0
                  ? "Payment is posted. Continue recovery work for the remaining balance."
                  : "Payment is posted and the recovery opportunity is fully recovered."
                : "Refresh the payer outcome here or continue tracking in Revenue Recovery."}
            </Typography>
          </Paper>

          {data.appealSubmittedAt && (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" fontWeight={800}>Submission Record</Typography>
              <Stack spacing={0.6} sx={{ mt: 0.75 }}>
                <Typography variant="body2"><b>Channel:</b> {String(data.appealSubmissionChannel || "—").replaceAll("_", " ")}</Typography>
                <Typography variant="body2"><b>Date:</b> {formatDate(data.appealExternalSubmittedAt)}</Typography>
                <Typography variant="body2"><b>Reference:</b> {data.appealSubmissionReference || "—"}</Typography>
                <Typography variant="body2"><b>Recorded:</b> {formatDateTime(data.appealSubmittedAt)}</Typography>
              </Stack>
            </Paper>
          )}

          {data.appealSubmittedAt && (
            <Paper variant="outlined" sx={{ p: 1.25 }} data-testid="appeal-payer-outcome">
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" fontWeight={800}>Payer Outcome</Typography>
                {!payerOutcomeFinal && (
                  <IconButton
                    size="small"
                    aria-label="Refresh payer outcome"
                    onClick={refreshPayerOutcome}
                    disabled={!canRefreshPayerOutcome || Boolean(action)}
                  >
                    {action === "payer-outcome" ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}
                  </IconButton>
                )}
              </Stack>
              <Stack spacing={0.6} sx={{ mt: 0.75 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">Claim status</Typography>
                  <Chip size="small" label={String(payerOutcome?.payerClaimStatus || data.claim?.payerClaimStatus || "NOT AVAILABLE").replaceAll("_", " ")} variant="outlined" />
                </Stack>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">Remittance</Typography>
                  <Typography variant="body2" fontWeight={650}>
                    {String(payerOutcome?.remittanceStatus || data.claim?.remittanceStatus || "NOT_AVAILABLE").replaceAll("_", " ")}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">Paid amount</Typography>
                  <Typography variant="body2" fontWeight={750} color={Number(payerOutcome?.paidAmount ?? data.claim?.paidAmount ?? 0) > 0 ? "success.main" : "text.primary"}>
                    {formatUSD(payerOutcome?.paidAmount ?? data.claim?.paidAmount ?? 0)}
                  </Typography>
                </Stack>
                {(payerOutcome?.paymentReference || data.claim?.paymentReference) && (
                  <Typography variant="caption" color="text.secondary">
                    Payment reference: {payerOutcome?.paymentReference || data.claim?.paymentReference}
                  </Typography>
                )}
                {payerOutcome?.message && (
                  <Typography variant="caption" color="text.secondary">{payerOutcome.message}</Typography>
                )}
              </Stack>
              {!payerOutcomeFinal && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Refresh />}
                  onClick={refreshPayerOutcome}
                  disabled={!canRefreshPayerOutcome || Boolean(action)}
                  sx={{ mt: 0.9 }}
                >
                  {action === "payer-outcome" ? "Refreshing..." : "Refresh Payer Outcome"}
                </Button>
              )}
            </Paper>
          )}

          {editable && (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" fontWeight={800}>Advanced Actions</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, mb: 0.75 }}>
                Assessment override is not part of the normal appeal flow. Use it only when payer or contract evidence supports a different assessment.
              </Typography>
              <Button size="small" color="inherit" startIcon={<Edit />} onClick={() => setOverrideOpen(true)}>
                Override Assessment
              </Button>
            </Paper>
          )}
        </Stack>
      </Box>

      <Dialog
        open={analysisProgressOpen}
        disableEscapeKeyDown
        aria-labelledby="recovery-analysis-progress-title"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle id="recovery-analysis-progress-title">
          {analysisProgressState === "COMPLETE"
            ? "Recovery Analysis Complete"
            : data?.aiAnalyzedAt
            ? "Re-running Recovery Analysis"
            : "Running Recovery Analysis"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} alignItems="center" sx={{ py: 2, minWidth: { sm: 420 } }}>
            {analysisProgressState === "COMPLETE" ? (
              <CheckCircle color="success" sx={{ fontSize: 58 }} />
            ) : (
              <CircularProgress size={52} />
            )}
            <Typography variant="body2" align="center">
              {analysisProgressMessage}
            </Typography>
            {analysisProgressState === "RUNNING" && (
              <Typography variant="caption" color="text.secondary" align="center">
                This dialog reflects the active backend analysis request. It will close when the analysis finishes.
              </Typography>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Override Recovery Assessment</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Use an override only when payer/contract evidence supports a different assessment. This change is audited.
          </Alert>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Appeal Eligible</InputLabel>
              <Select
                label="Appeal Eligible"
                value={override.appealEligible}
                onChange={(event) => setOverride((current) => ({ ...current, appealEligible: event.target.value }))}
              >
                <MenuItem value="">No change</MenuItem>
                <MenuItem value="YES">Yes</MenuItem>
                <MenuItem value="NO">No</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Correctable</InputLabel>
              <Select
                label="Correctable"
                value={override.correctable}
                onChange={(event) => setOverride((current) => ({ ...current, correctable: event.target.value }))}
              >
                <MenuItem value="">No change</MenuItem>
                <MenuItem value="YES">Yes</MenuItem>
                <MenuItem value="NO">No</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Override reason"
              multiline
              minRows={3}
              value={override.reason}
              onChange={(event) => setOverride((current) => ({ ...current, reason: event.target.value }))}
              inputProps={{ maxLength: 1000 }}
              helperText="Required, 10–1000 characters"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverrideOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={
              Boolean(action) ||
              override.reason.trim().length < 10 ||
              (override.appealEligible === "" && override.correctable === "")
            }
            onClick={saveOverride}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={uploadOpen} onClose={() => !action && setUploadOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Upload Supporting Evidence</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            This adds a new document to the appeal without changing the original submitted claim. The new document will be automatically selected for this appeal.
          </Alert>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Document Type</InputLabel>
              <Select label="Document Type" value={uploadType} onChange={(event) => setUploadType(event.target.value)}>
                {DOCUMENT_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>{type.replaceAll("_", " ")}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" component="label" startIcon={<UploadFile />}>
              {uploadFile ? uploadFile.name : "Choose PDF / Image"}
              <input
                hidden
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/png,image/jpeg,image/tiff"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </Button>
            {uploadFile && (
              <Typography variant="body2" color="text.secondary">
                Selected: {uploadFile.name}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadOpen(false)} disabled={Boolean(action)}>Cancel</Button>
          <Button variant="contained" onClick={uploadEvidence} disabled={!uploadFile || action === "upload"}>
            {action === "upload" ? "Uploading..." : "Upload & Add to Appeal"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} fullWidth maxWidth="lg">
        <DialogTitle>
          {preview?.doc?.fileName || "Document Preview"}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, height: { xs: "70vh", md: "78vh" } }}>
          {preview?.url && (
            <Box
              component="iframe"
              title={preview.doc.fileName}
              src={preview.url}
              sx={{ border: 0, width: "100%", height: "100%" }}
            />
          )}
        </DialogContent>
        <DialogActions>
          {canDownloadDocuments && preview?.doc && (
            <Button startIcon={<Download />} onClick={() => downloadDocument(preview.doc)}>
              Download
            </Button>
          )}
          <Button onClick={() => setPreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={packageOpen} onClose={() => setPackageOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Appeal Package Preview</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity={evidenceIds.length > 0 ? "success" : "warning"}>
              {evidenceIds.length > 0
                ? `${evidenceIds.length} document${evidenceIds.length === 1 ? "" : "s"} will be included.`
                : "No evidence documents are selected. You may continue only if the appeal does not require attachments."}
            </Alert>
            <Box>
              <Typography variant="subtitle2">Patient / Claim</Typography>
              <Typography variant="body2">
                {data.claim?.patientName || "—"} · {data.claim?.payerName || "—"} · {data.claim?.insurerClaimNo || "No payer claim #"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2">Appeal Rationale</Typography>
              <Paper variant="outlined" sx={{ p: 1.5, mt: 0.75, whiteSpace: "pre-wrap" }}>
                <Typography variant="body2">{rationale || "No rationale entered."}</Typography>
              </Paper>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Included Evidence</Typography>
              {selectedDocumentRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No documents selected.</Typography>
              ) : (
                <Stack spacing={0.75}>
                  {selectedDocumentRows.map((doc, index) => (
                    <Typography key={doc.id} variant="body2">
                      {index + 1}. {doc.fileName} ({String(doc.type).replaceAll("_", " ")})
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>
            <Alert severity="info">
              This preview shows what PRISM will treat as the appeal package. It does not transmit or merge the evidence files into a payer submission.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPackageOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={submissionOpen} onClose={() => setSubmissionOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Record External Submission</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            PRISM does not transmit the appeal to the payer. Submit through the approved external channel first, then record how and when it was submitted.
          </Alert>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Submission Channel</InputLabel>
              <Select
                label="Submission Channel"
                value={submission.channel}
                onChange={(event) => setSubmission((current) => ({ ...current, channel: event.target.value }))}
              >
                {SUBMISSION_CHANNELS.map(([value, label]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Submission / Tracking Reference"
              value={submission.reference}
              onChange={(event) => setSubmission((current) => ({ ...current, reference: event.target.value }))}
              inputProps={{ maxLength: 200 }}
              helperText="Optional external confirmation/reference. If left blank, PRISM creates a unique internal tracking reference."
            />
            <TextField
              label="Submission Date"
              type="date"
              value={submission.date}
              onChange={(event) => setSubmission((current) => ({ ...current, date: event.target.value }))}
              inputProps={{ max: todayInputValue() }}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmissionOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={confirmSubmission}>
            Continue to Confirmation
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
