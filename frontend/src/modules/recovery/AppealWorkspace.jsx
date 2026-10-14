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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  CheckCircle,
  Close,
  Edit,
  FactCheck,
  Save,
  Send
} from "@mui/icons-material";
import { useParams } from "react-router-dom";
import { DenialsApi } from "../../api/denials.js";
import { AuthApi } from "../../api/auth.js";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { useToast } from "../../context/ToastContext.jsx";
import { formatUSD } from "../../utils/currency.js";

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-US");
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not assessed";
}

export default function AppealWorkspace() {
  const { id } = useParams();
  const user = AuthApi.getUser();
  const canEdit = hasPermission(user, PERMISSIONS.RECOVERY_EDIT);
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

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await DenialsApi.getAppealWorkspace(id);
      setData(result);
      setRationale(result.appealRationale || "");
      setEvidenceIds(result.appealEvidenceDocumentIds || []);
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

  async function runAnalysis() {
    setAction("analysis");
    try {
      const result = await DenialsApi.analyze(id);
      await load();
      if (result?.ai?.llmUsed) {
        showToast("AI denial analysis completed.", "success");
      } else {
        showToast(
          "Analysis completed using Recovery Rules. No claim information was sent to an external AI service.",
          "info"
        );
      }
    } catch (error) {
      showDialog(error?.message || "Recovery analysis could not be completed.", {
        title: "Analysis failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function saveDraft() {
    setAction("save");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale,
        evidenceDocumentIds: evidenceIds
      });
      await load();
      showToast("Appeal draft saved", "success");
    } catch (error) {
      showDialog(error?.message || "Appeal draft could not be saved.", {
        title: "Save failed",
        severity: "error"
      });
    } finally {
      setAction("");
    }
  }

  async function prepareAppeal() {
    setAction("prepare");
    try {
      await DenialsApi.saveAppealDraft(id, {
        rationale,
        evidenceDocumentIds: evidenceIds
      });
      await DenialsApi.prepareAppeal(id);
      await load();
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

  async function markSubmitted() {
    const ok = await confirmDialog(
      "This records the appeal as submitted in PRISM. It does not transmit anything to the payer. Continue only after the appeal has been submitted through the approved payer/clearinghouse channel.",
      {
        title: "Mark appeal submitted?",
        severity: "warning",
        confirmLabel: "Mark Submitted",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    setAction("submit");
    try {
      const result = await DenialsApi.markAppealSubmitted(id, {
        confirmed: true
      });
      await load();
      showDialog(
        result?.transmission?.note ||
          "Appeal status was recorded as submitted.",
        {
          title: "Appeal submitted status recorded",
          severity: "success"
        }
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
    const payload = {
      reason: override.reason
    };
    if (override.appealEligible !== "") {
      payload.appealEligible = override.appealEligible === "YES";
    }
    if (override.correctable !== "") {
      payload.correctable = override.correctable === "YES";
    }

    setAction("override");
    try {
      await DenialsApi.overrideAssessment(id, payload);
      setOverrideOpen(false);
      setOverride({ appealEligible: "", correctable: "", reason: "" });
      await load();
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

  function toggleEvidence(documentId) {
    setEvidenceIds((current) =>
      current.includes(documentId)
        ? current.filter((idValue) => idValue !== documentId)
        : [...current, documentId]
    );
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
  const documents = data.claim?.documents || [];
  const selectedDocs = new Set(evidenceIds);

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
            Review the denial, supporting evidence and appeal rationale before recording submission.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Close />}
          onClick={() => window.close()}
        >
          Close Appeal Tab
        </Button>
      </Stack>

      {data.status === "APPEAL_SUBMITTED" && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Appeal is recorded as submitted. You can close this tab and return to Revenue Recovery;
          the original tab will refresh when it receives focus.
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
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography fontWeight={700}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="h6" fontWeight={800}>
                  Recovery Assessment
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  These values are derived from payer/claim facts and are read-only by default.
                </Typography>
              </Box>
              {canEdit && (
                <Button
                  size="small"
                  startIcon={<Edit />}
                  onClick={() => setOverrideOpen(true)}
                >
                  Override Assessment
                </Button>
              )}
            </Stack>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                label={"Appeal Eligible: " + yesNo(data.appealEligible)}
                color={data.appealEligible === true ? "success" : data.appealEligible === false ? "error" : "default"}
              />
              <Chip
                label={"Correctable: " + yesNo(data.correctable)}
                variant="outlined"
              />
              {data.assessmentOverriddenAt && (
                <Chip
                  label={"Overridden " + formatDate(data.assessmentOverriddenAt)}
                  color="warning"
                  variant="outlined"
                />
              )}
            </Stack>

            {data.assessmentOverrideReason && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <b>Override reason:</b> {data.assessmentOverrideReason}
              </Alert>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="h6" fontWeight={800}>
                  Recovery Analysis
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Analysis may use deterministic Recovery Rules or an explicitly approved external AI service.
                </Typography>
              </Box>
              {canEdit && (
                <Button
                  variant="outlined"
                  startIcon={<FactCheck />}
                  onClick={runAnalysis}
                  disabled={Boolean(action)}
                >
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
                  <Chip
                    size="small"
                    label={(data.aiConfidence ?? "—") + "% confidence"}
                    variant="outlined"
                  />
                </Stack>
                <Box>
                  <Typography variant="subtitle2">Why this denial likely occurred</Typography>
                  <Typography variant="body2">{data.aiExplanation || "—"}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2">Recommended next action</Typography>
                  <Typography variant="body2">{data.recommendedAction || "—"}</Typography>
                </Box>
              </Stack>
            ) : (
              <Alert severity="info">
                Run recovery analysis before preparing an appeal.
              </Alert>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" fontWeight={800}>
              Supporting Evidence
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select only documents needed for this appeal. Claim documents are not modified here.
            </Typography>

            {Array.isArray(data.requiredDocuments) && data.requiredDocuments.length > 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Suggested evidence: {data.requiredDocuments.map((item) => String(item).replaceAll("_", " ")).join(", ")}
              </Alert>
            )}

            {documents.length === 0 ? (
              <Alert severity="warning">No claim documents are available for this appeal.</Alert>
            ) : (
              <Stack spacing={0.75}>
                {documents.map((doc) => (
                  <FormControlLabel
                    key={doc.id}
                    control={
                      <Checkbox
                        checked={selectedDocs.has(doc.id)}
                        disabled={!editable}
                        onChange={() => toggleEvidence(doc.id)}
                      />
                    }
                    label={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {doc.fileName}
                        </Typography>
                        <Chip size="small" label={String(doc.type).replaceAll("_", " ")} />
                        <Chip
                          size="small"
                          label={doc.verified ? "Verified" : "Not verified"}
                          color={doc.verified ? "success" : "default"}
                          variant="outlined"
                        />
                      </Stack>
                    }
                  />
                ))}
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" fontWeight={800}>
              Appeal Rationale
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Editable by authorized recovery users. Payer facts and claim identifiers above remain read-only.
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
            />
            <Typography variant="caption" color="text.secondary">
              {rationale.length}/5000
            </Typography>
          </Paper>
        </Stack>

        <Stack spacing={2.5}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>
                Appeal Workflow
              </Typography>
              <Stack spacing={1.25}>
                <Chip
                  icon={data.aiAnalyzedAt ? <CheckCircle /> : undefined}
                  label={data.aiAnalyzedAt ? "Analysis completed" : "Analysis required"}
                  color={data.aiAnalyzedAt ? "success" : "default"}
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

              <Divider sx={{ my: 2 }} />

              <Stack spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<Save />}
                  disabled={!editable || Boolean(action)}
                  onClick={saveDraft}
                >
                  {action === "save" ? "Saving..." : "Save Draft"}
                </Button>

                <Button
                  variant="contained"
                  disabled={
                    !editable ||
                    Boolean(action) ||
                    !data.aiAnalyzedAt ||
                    data.appealEligible !== true ||
                    !rationale.trim()
                  }
                  onClick={prepareAppeal}
                >
                  {action === "prepare" ? "Preparing..." : "Prepare Appeal"}
                </Button>

                <Button
                  color="success"
                  variant="contained"
                  startIcon={<Send />}
                  disabled={
                    !canEdit ||
                    Boolean(action) ||
                    data.status !== "APPEAL_PREPARED"
                  }
                  onClick={markSubmitted}
                >
                  {action === "submit" ? "Updating..." : "Mark Appeal Submitted"}
                </Button>
              </Stack>

              <Alert severity="warning" sx={{ mt: 2 }}>
                “Mark Appeal Submitted” records workflow status only. PRISM does not transmit an appeal to a payer from this page yet.
              </Alert>
            </CardContent>
          </Card>

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={800}>
              What is editable?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Appeal rationale and evidence selection are editable for authorized recovery users.
              Claim facts, payer denial data, calculated recovery amounts and system assessments are read-only.
            </Typography>
          </Paper>
        </Stack>
      </Box>

      <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Override Recovery Assessment</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Use an override only when the payer/contract evidence supports a different assessment. The change is audited.
          </Alert>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Appeal Eligible</InputLabel>
              <Select
                label="Appeal Eligible"
                value={override.appealEligible}
                onChange={(event) =>
                  setOverride((current) => ({
                    ...current,
                    appealEligible: event.target.value
                  }))
                }
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
                onChange={(event) =>
                  setOverride((current) => ({
                    ...current,
                    correctable: event.target.value
                  }))
                }
              >
                <MenuItem value="">No change</MenuItem>
                <MenuItem value="YES">Yes</MenuItem>
                <MenuItem value="NO">No</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Override Reason"
              multiline
              minRows={3}
              value={override.reason}
              onChange={(event) =>
                setOverride((current) => ({
                  ...current,
                  reason: event.target.value
                }))
              }
              helperText="Required. Explain the payer, contract, or claim evidence supporting the override."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverrideOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              Boolean(action) ||
              override.reason.trim().length < 10 ||
              (override.appealEligible === "" && override.correctable === "")
            }
            onClick={saveOverride}
          >
            {action === "override" ? "Saving..." : "Save Override"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
