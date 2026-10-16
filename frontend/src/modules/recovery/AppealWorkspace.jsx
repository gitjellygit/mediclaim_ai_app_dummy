import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  CheckCircle,
  Close,
  Description,
  Download,
  Edit,
  FactCheck,
  OpenInNew,
  Save,
  Send,
  UploadFile,
  Visibility
} from "@mui/icons-material";
import { useParams } from "react-router-dom";
import { DenialsApi } from "../../api/denials.js";
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

  const [analysisProgressOpen, setAnalysisProgressOpen] = React.useState(false);
  const [analysisProgressState, setAnalysisProgressState] = React.useState("RUNNING");
  const [analysisProgressMessage, setAnalysisProgressMessage] = React.useState("");

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

  function openEligibilityReview() {
    if (!data?.claimId) return;
    window.open(
      `/journey?claimId=${encodeURIComponent(data.claimId)}&stage=eligibility`,
      "_blank",
      "noopener,noreferrer"
    );
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

    setAction("save-rationale");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale: trimmed,
        evidenceDocumentIds: evidenceIds
      });
      await load();
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

    setAction("clear-rationale");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale: "",
        evidenceDocumentIds: evidenceIds
      });
      await load();
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
      `Prepare this appeal with ${selectedCount} selected evidence document${selectedCount === 1 ? "" : "s"}? This moves the case into Appeal Prepared and indicates the package has been reviewed.`,
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

    // Never stack the global confirmation dialog on top of the submission
    // details modal. MUI traps focus in the first modal, which can make the
    // confirmation inaccessible to keyboard users and automated browsers.
    setSubmissionOpen(false);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const ok = await confirmDialog(
      "Are you sure this appeal has already been submitted through the selected external channel? PRISM will record the submission and lock the appeal for editing. PRISM itself will not transmit anything to the payer.",
      {
        title: "Submit appeal?",
        severity: "warning",
        confirmLabel: "Yes, Submit Appeal",
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
  const hasDraftChanges = !rationaleSaved;
  const suggestedEvidenceMissing =
    Array.isArray(data.requiredDocuments) &&
    data.requiredDocuments.length > 0 &&
    evidenceIds.length === 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1320, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "flex-start" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Appeal Workspace
          </Typography>
          <Typography color="text.secondary">
            Review the denial, inspect evidence, build the appeal package and record submission.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Close />} onClick={() => window.close()}>
          Close Appeal Tab
        </Button>
      </Stack>

      {submitted && (
        <Alert severity="success" sx={{ mb: 3 }}>
          This appeal is recorded as submitted/finalized and is now read-only.
          Return to Revenue Recovery to continue tracking payer outcome.
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" },
          gap: 2.5
        }}
      >
        <Stack spacing={2.5}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
              Case Overview
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1.5
              }}
            >
              {[
                ["Patient", data.claim?.patientName || "—"],
                ["Payer", data.claim?.payerName || "—"],
                ["Payer Claim #", data.claim?.insurerClaimNo || "—"],
                ["Claim Form", data.claim?.claimForm || "—"],
                ["Date of Service", formatDate(data.claim?.dateOfService)],
                ["Revenue at Risk", formatUSD(data.revenueAtRisk)],
                ["Denial Category", data.denialCategory || "UNCLASSIFIED"],
                ["CARC / RARC", [data.carcCode, data.rarcCode].filter(Boolean).join(" / ") || "—"],
                ["Appeal Deadline", formatDate(data.appealDeadline)],
                ["Current Status", String(data.status || "").replaceAll("_", " ")]
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography fontWeight={700}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight={800}>Recovery Assessment</Typography>
                <Typography variant="body2" color="text.secondary">
                  System-derived values are read-only unless an authorized user records an audited override.
                </Typography>
              </Box>
              {editable && (
                <Button size="small" startIcon={<Edit />} onClick={() => setOverrideOpen(true)}>
                  Override Assessment
                </Button>
              )}
            </Stack>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                label={"Appeal Eligible: " + yesNo(data.appealEligible)}
                color={data.appealEligible === true ? "success" : data.appealEligible === false ? "error" : "default"}
              />
              <Chip label={"Correctable: " + yesNo(data.correctable)} variant="outlined" />
              {data.assessmentOverriddenAt && (
                <Chip label={"Overridden " + formatDate(data.assessmentOverriddenAt)} color="warning" variant="outlined" />
              )}
            </Stack>

            {data.assessmentOverrideReason && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <b>Override reason:</b> {data.assessmentOverrideReason}
              </Alert>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight={800}>Recovery Analysis</Typography>
                <Typography variant="body2" color="text.secondary">
                  Analysis uses deterministic Recovery Rules unless an explicitly approved external AI configuration is enabled.
                </Typography>
              </Box>
              {editable && (
                <Button variant="outlined" startIcon={<FactCheck />} onClick={runAnalysis} disabled={Boolean(action)}>
                  {action === "analysis" ? "Analyzing..." : data.aiAnalyzedAt ? "Re-run Analysis" : "Run Analysis"}
                </Button>
              )}
            </Stack>

            {data.aiAnalyzedAt ? (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={data.aiProvider === "OPENAI" ? "Approved External AI" : "Recovery Rules"}
                    color={data.aiProvider === "OPENAI" ? "secondary" : "info"}
                  />
                  <Chip size="small" label={(data.aiConfidence ?? "—") + "% confidence"} variant="outlined" />
                </Stack>
                <Box>
                  <Typography variant="subtitle2">Why this denial likely occurred</Typography>
                  <Typography variant="body2">{data.aiExplanation || "—"}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2">Recommended next action</Typography>
                  <Typography variant="body2">{data.recommendedAction || "—"}</Typography>
                  {String(data.denialCategory || "").toUpperCase() === "ELIGIBILITY" && (
                    <Stack spacing={1} sx={{ mt: 1.25 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<OpenInNew />}
                        onClick={openEligibilityReview}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Re-check Eligibility
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Opens the same claim's Eligibility stage in a new tab. Re-checking coverage does not resubmit the claim.
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </Stack>
            ) : (
              <Alert severity="info">Run recovery analysis before preparing an appeal.</Alert>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight={800}>Supporting Evidence</Typography>
                <Typography variant="body2" color="text.secondary">
                  Existing claim documents are read-only. Review them, then select only the documents that should be included in this appeal package.
                </Typography>
              </Box>
              {canUpload && (
                <Button
                  variant="outlined"
                  startIcon={<UploadFile />}
                  onClick={() => setUploadOpen(true)}
                  disabled={Boolean(action)}
                >
                  Upload Supporting Evidence
                </Button>
              )}
            </Stack>

            {Array.isArray(data.requiredDocuments) && data.requiredDocuments.length > 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Suggested evidence: {data.requiredDocuments.map((item) => String(item).replaceAll("_", " ")).join(", ")}
              </Alert>
            )}

            {documents.length === 0 ? (
              <Alert severity="warning">No claim documents are available for this appeal.</Alert>
            ) : (
              <Stack spacing={1}>
                {documents.map((doc) => {
                  const addedForThisAppeal = doc.appealCaseId === data.id;
                  return (
                    <Paper key={doc.id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" spacing={1}>
                        <FormControlLabel
                          sx={{ m: 0, flex: 1 }}
                          control={
                            <Checkbox
                              checked={selectedDocs.has(doc.id)}
                              disabled={!editable || Boolean(action)}
                              onChange={() => toggleEvidence(doc.id)}
                            />
                          }
                          label={
                            <Box>
                              <Typography variant="body2" fontWeight={700}>{doc.fileName}</Typography>
                              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                                <Chip size="small" label={String(doc.type).replaceAll("_", " ")} />
                                <Chip
                                  size="small"
                                  label={doc.verified ? "Verified" : "Not verified"}
                                  color={doc.verified ? "success" : "default"}
                                  variant="outlined"
                                />
                                {addedForThisAppeal && (
                                  <Chip size="small" label="Added for this appeal" color="info" variant="outlined" />
                                )}
                              </Stack>
                            </Box>
                          }
                        />
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="View document">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => viewDocument(doc)}
                                disabled={Boolean(action)}
                              >
                                <Visibility fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {canDownloadDocuments && (
                            <Tooltip title="Download document">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => downloadDocument(doc)}
                                  disabled={Boolean(action)}
                                >
                                  <Download fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              Checkbox = include this document in the appeal package. It does not modify the source document.
            </Typography>
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" fontWeight={800}>Appeal Rationale</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter at least {APPEAL_RATIONALE_MIN_CHARS} characters, then save. The workflow is not considered complete until the rationale is saved.
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={8}
              value={rationale}
              disabled={!editable}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Explain the factual basis for the appeal using the payer denial reason, claim facts and supporting evidence."
              inputProps={{ maxLength: 5000 }}
              error={Boolean(rationaleTrimmed) && !rationaleLengthValid}
              helperText={
                rationaleTrimmed.length < APPEAL_RATIONALE_MIN_CHARS
                  ? `Minimum ${APPEAL_RATIONALE_MIN_CHARS} characters required. ${Math.max(0, APPEAL_RATIONALE_MIN_CHARS - rationaleTrimmed.length)} more needed.`
                  : rationaleSaved
                  ? "Saved and ready."
                  : "Minimum met. Save the rationale to mark it complete."
              }
            />
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={1}
              sx={{ mt: 1.25 }}
            >
              <Typography variant="caption" color="text.secondary">
                {rationale.length}/5000 characters · minimum {APPEAL_RATIONALE_MIN_CHARS}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="text"
                  color="inherit"
                  disabled={!editable || Boolean(action) || (!rationale && !savedRationale)}
                  onClick={clearRationale}
                >
                  {action === "clear-rationale" ? "Clearing..." : "Clear"}
                </Button>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  disabled={
                    !editable ||
                    Boolean(action) ||
                    !rationaleLengthValid ||
                    rationaleSaved
                  }
                  onClick={saveRationale}
                >
                  {action === "save-rationale" ? "Saving..." : "Save Rationale"}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>

        <Stack spacing={2.5}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>Appeal Workflow</Typography>
              <Stack spacing={1.25}>
                <Chip
                  icon={data.aiAnalyzedAt ? <CheckCircle /> : undefined}
                  label={data.aiAnalyzedAt ? "Analysis completed" : "Analysis required"}
                  color={data.aiAnalyzedAt ? "success" : "default"}
                  variant="outlined"
                />
                <Chip
                  icon={rationaleSaved ? <CheckCircle /> : undefined}
                  label={
                    rationaleSaved
                      ? "Rationale complete"
                      : rationaleLengthValid
                      ? "Rationale ready — save required"
                      : `Rationale required (minimum ${APPEAL_RATIONALE_MIN_CHARS} characters)`
                  }
                  color={rationaleSaved ? "success" : rationaleLengthValid ? "warning" : "default"}
                  variant="outlined"
                />
                <Chip
                  icon={evidenceIds.length > 0 && evidenceSaved ? <CheckCircle /> : undefined}
                  label={`${evidenceIds.length} evidence document${evidenceIds.length === 1 ? "" : "s"} selected`}
                  color={evidenceIds.length > 0 && evidenceSaved ? "success" : evidenceIds.length > 0 ? "warning" : "default"}
                  variant="outlined"
                />
                <Chip
                  icon={data.appealPreparedAt ? <CheckCircle /> : undefined}
                  label={data.appealPreparedAt ? "Appeal prepared" : "Appeal not prepared"}
                  color={data.appealPreparedAt ? "success" : "default"}
                  variant="outlined"
                />
                <Chip
                  icon={data.appealSubmittedAt ? <CheckCircle /> : undefined}
                  label={data.appealSubmittedAt ? "Appeal submitted" : "Submission not recorded"}
                  color={data.appealSubmittedAt ? "success" : "default"}
                  variant="outlined"
                />
              </Stack>

              {suggestedEvidenceMissing && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Recovery analysis recommends supporting evidence, but no documents are currently selected.
                </Alert>
              )}

              <Divider sx={{ my: 2 }} />

              {hasDraftChanges && editable && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  Save the rationale and evidence selection before preparing the appeal.
                </Alert>
              )}

              <Stack spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<Description />}
                  disabled={!rationaleLengthValid}
                  onClick={() => setPackageOpen(true)}
                >
                  Preview Appeal Package
                </Button>

                <Button
                  variant="contained"
                  disabled={
                    !editable ||
                    Boolean(action) ||
                    !data.aiAnalyzedAt ||
                    data.appealEligible !== true ||
                    !draftSaved
                  }
                  onClick={prepareAppeal}
                >
                  {action === "prepare" ? "Preparing..." : data.status === "APPEAL_PREPARED" ? "Re-prepare Appeal" : "Prepare Appeal"}
                </Button>

                <Button
                  color="success"
                  variant="contained"
                  startIcon={<Send />}
                  disabled={!canEdit || Boolean(action) || data.status !== "APPEAL_PREPARED"}
                  onClick={() => setSubmissionOpen(true)}
                >
                  {action === "submit" ? "Submitting..." : "Submit Appeal"}
                </Button>
              </Stack>

              <Alert severity="warning" sx={{ mt: 2 }}>
                Recording submission does not transmit anything to the payer. Use it only after submission through the approved external channel.
              </Alert>
            </CardContent>
          </Card>

          {data.appealSubmittedAt && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={800}>Submission Record</Typography>
              <Stack spacing={0.8} sx={{ mt: 1 }}>
                <Typography variant="body2"><b>Channel:</b> {String(data.appealSubmissionChannel || "—").replaceAll("_", " ")}</Typography>
                <Typography variant="body2"><b>External submission date:</b> {formatDate(data.appealExternalSubmittedAt)}</Typography>
                <Typography variant="body2"><b>Reference:</b> {data.appealSubmissionReference || "—"}</Typography>
                <Typography variant="body2"><b>Recorded in PRISM:</b> {formatDateTime(data.appealSubmittedAt)}</Typography>
              </Stack>
            </Paper>
          )}

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={800}>What is editable?</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Appeal rationale, evidence selection, and new appeal-supporting uploads are editable before submission. Claim facts, payer denial data, original documents, calculated recovery amounts, and system assessments remain read-only except through the audited assessment override.
            </Typography>
          </Paper>
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
        <DialogTitle>Submit Appeal</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            PRISM records the appeal submission from this screen but does not transmit the appeal to the payer. Enter how and when the appeal was actually submitted through the approved external channel.
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
              label="Submission Reference"
              value={submission.reference}
              onChange={(event) => setSubmission((current) => ({ ...current, reference: event.target.value }))}
              inputProps={{ maxLength: 200 }}
              helperText="Optional payer portal confirmation, fax reference, tracking number, etc."
            />
            <TextField
              label="Submission Date"
              type="date"
              value={submission.date}
              onChange={(event) => setSubmission((current) => ({ ...current, date: event.target.value }))}
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
