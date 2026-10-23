import React from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
import { ClaimsApi } from "../../api/claims.js";
import { useToast } from "../../context/ToastContext.jsx";

const DOCUMENT_OPTIONS = [
  "PRIOR_AUTHORIZATION",
  "PROGRESS_NOTE",
  "OPERATIVE_NOTE",
  "LAB_REPORT",
  "RADIOLOGY",
  "PRESCRIPTION",
  "DISCHARGE_SUMMARY"
];

function dateOnly(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function display(value) {
  return String(value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PriorAuthCasePanel({ claim, priorAuthCase, onRefresh }) {
  const { showDialog, confirmDialog } = useToast();
  const [busy, setBusy] = React.useState("");
  const [form, setForm] = React.useState({
    urgency: "STANDARD",
    requiredDocuments: [],
    evidenceDocumentIds: [],
    responseDueAt: "",
    additionalInfoDueAt: "",
    authorizationNo: "",
    expiry: "",
    notes: ""
  });
  const [submission, setSubmission] = React.useState({
    channel: "PAYER_PORTAL",
    date: new Date().toISOString().slice(0, 10),
    reference: ""
  });

  React.useEffect(() => {
    setForm({
      urgency: priorAuthCase?.urgency || "STANDARD",
      requiredDocuments: Array.isArray(priorAuthCase?.requiredDocuments)
        ? priorAuthCase.requiredDocuments
        : [],
      evidenceDocumentIds: Array.isArray(priorAuthCase?.evidenceDocumentIds)
        ? priorAuthCase.evidenceDocumentIds
        : [],
      responseDueAt: dateOnly(priorAuthCase?.responseDueAt),
      additionalInfoDueAt: dateOnly(priorAuthCase?.additionalInfoDueAt),
      authorizationNo: priorAuthCase?.authorizationNo || claim?.authorizationNo || "",
      expiry: dateOnly(priorAuthCase?.expiry || claim?.priorAuthExpiry),
      notes: priorAuthCase?.notes || ""
    });
  }, [priorAuthCase, claim?.authorizationNo, claim?.priorAuthExpiry]);

  async function run(name, action) {
    setBusy(name);
    try {
      const result = await action();
      await onRefresh?.();
      return result;
    } catch (error) {
      showDialog(error?.message || "Prior authorization action failed.", {
        title: "Prior authorization",
        severity: "error"
      });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function startCase() {
    await run("start", () =>
      ClaimsApi.createPriorAuthCase(claim.id, {
        urgency: form.urgency,
        requiredDocuments: form.requiredDocuments,
        notes: form.notes || null
      })
    );
  }

  function payload(status = priorAuthCase?.status) {
    const toIso = (value) => value ? new Date(`${value}T23:59:59.000Z`).toISOString() : null;
    return {
      status,
      urgency: form.urgency,
      requiredDocuments: form.requiredDocuments,
      evidenceDocumentIds: form.evidenceDocumentIds,
      responseDueAt: toIso(form.responseDueAt),
      additionalInfoDueAt: toIso(form.additionalInfoDueAt),
      authorizationNo: form.authorizationNo || null,
      expiry: toIso(form.expiry),
      notes: form.notes || null
    };
  }

  async function update(status = priorAuthCase?.status) {
    return run("save", () => ClaimsApi.updatePriorAuthCase(claim.id, payload(status)));
  }

  async function recordSubmission() {
    const confirmed = await confirmDialog(
      "Confirm that the prior authorization was submitted through the selected external payer channel. PRISM will record the submission but will not transmit it from this action.",
      {
        title: "Record prior authorization submission?",
        severity: "warning",
        confirmLabel: "Record Submission",
        cancelLabel: "Cancel"
      }
    );
    if (!confirmed) return;

    await run("submit", () =>
      ClaimsApi.submitPriorAuthCase(claim.id, {
        confirmed: true,
        submissionChannel: submission.channel,
        submissionDate: submission.date,
        submissionReference: submission.reference || null
      })
    );
  }

  const documents = Array.isArray(claim?.documents) ? claim.documents : [];
  const packageEditable = ["REQUIRED", "DRAFT", "READY"].includes(priorAuthCase?.status);
  const awaitingDecision = ["SUBMITTED", "PENDING", "ADDITIONAL_INFO"].includes(priorAuthCase?.status);
  const final = ["APPROVED", "DENIED"].includes(priorAuthCase?.status);

  if (!priorAuthCase) {
    if (claim?.priorAuthRequired !== true) {
      return (
        <Alert severity="info">
          Determine whether authorization is required first. A case is created only when authorization is required.
        </Alert>
      );
    }

    return (
      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography variant="subtitle2" fontWeight={800}>Prior Auth Case</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
          Authorization is required. Start a tracked case for evidence, deadlines, submission and payer decision.
        </Typography>
        <Button size="small" variant="contained" onClick={startCase} disabled={Boolean(busy)}>
          {busy === "start" ? "Starting..." : "Start Prior Auth Case"}
        </Button>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1 }} data-testid="prior-auth-case-panel">
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" fontWeight={800}>Prior Auth Case</Typography>
        <Chip
          size="small"
          label={display(priorAuthCase.status)}
          color={priorAuthCase.status === "APPROVED" ? "success" : priorAuthCase.status === "DENIED" ? "error" : "warning"}
          variant="outlined"
        />
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.75, mt: 1 }}>
        <FormControl size="small" disabled={!packageEditable}>
          <InputLabel>Urgency</InputLabel>
          <Select
            label="Urgency"
            value={form.urgency}
            onChange={(event) => setForm((current) => ({ ...current, urgency: event.target.value }))}
          >
            <MenuItem value="STANDARD">Standard</MenuItem>
            <MenuItem value="EXPEDITED">Expedited</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          type="date"
          label="Payer Response Due"
          InputLabelProps={{ shrink: true }}
          value={form.responseDueAt}
          disabled={final}
          onChange={(event) => setForm((current) => ({ ...current, responseDueAt: event.target.value }))}
        />
      </Box>

      {packageEditable && (
        <>
          <FormControl size="small" fullWidth sx={{ mt: 0.75 }}>
            <InputLabel>Required Evidence Types</InputLabel>
            <Select
              multiple
              label="Required Evidence Types"
              value={form.requiredDocuments}
              onChange={(event) => setForm((current) => ({ ...current, requiredDocuments: event.target.value }))}
              renderValue={(selected) => selected.map(display).join(", ")}
            >
              {DOCUMENT_OPTIONS.map((type) => (
                <MenuItem key={type} value={type}>{display(type)}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            Evidence selected for this prior-auth package
          </Typography>
          <Stack spacing={0.2}>
            {documents.length === 0 ? (
              <Typography variant="caption" color="warning.main">No claim documents are available.</Typography>
            ) : documents.map((doc) => (
              <FormControlLabel
                key={doc.id}
                control={
                  <Checkbox
                    size="small"
                    checked={form.evidenceDocumentIds.includes(doc.id)}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        evidenceDocumentIds: event.target.checked
                          ? [...current.evidenceDocumentIds, doc.id]
                          : current.evidenceDocumentIds.filter((id) => id !== doc.id)
                      }))
                    }
                  />
                }
                label={
                  <Typography variant="caption">
                    {doc.fileName} · {display(doc.type)}
                  </Typography>
                }
              />
            ))}
          </Stack>
        </>
      )}

      {awaitingDecision && (
        <>
          <Divider sx={{ my: 0.8 }} />
          <TextField
            size="small"
            fullWidth
            type="date"
            label="Additional Information Due"
            InputLabelProps={{ shrink: true }}
            value={form.additionalInfoDueAt}
            onChange={(event) => setForm((current) => ({ ...current, additionalInfoDueAt: event.target.value }))}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.75, mt: 0.75 }}>
            <TextField
              size="small"
              label="Authorization Number"
              value={form.authorizationNo}
              onChange={(event) => setForm((current) => ({ ...current, authorizationNo: event.target.value }))}
            />
            <TextField
              size="small"
              type="date"
              label="Authorization Expiry"
              InputLabelProps={{ shrink: true }}
              value={form.expiry}
              onChange={(event) => setForm((current) => ({ ...current, expiry: event.target.value }))}
            />
          </Box>
        </>
      )}

      {!final && (
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label="Prior Auth Notes"
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          sx={{ mt: 0.75 }}
        />
      )}

      {priorAuthCase.status === "READY" && (
        <Paper variant="outlined" sx={{ p: 0.75, mt: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            Record external payer submission
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.6, mt: 0.5 }}>
            <FormControl size="small">
              <InputLabel>Channel</InputLabel>
              <Select
                label="Channel"
                value={submission.channel}
                onChange={(event) => setSubmission((current) => ({ ...current, channel: event.target.value }))}
              >
                <MenuItem value="PAYER_PORTAL">Payer Portal</MenuItem>
                <MenuItem value="FAX">Fax</MenuItem>
                <MenuItem value="PHONE">Phone</MenuItem>
                <MenuItem value="OTHER">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label="Submission Date"
              inputProps={{ max: new Date().toISOString().slice(0, 10) }}
              InputLabelProps={{ shrink: true }}
              value={submission.date}
              onChange={(event) => setSubmission((current) => ({ ...current, date: event.target.value }))}
            />
          </Box>
          <TextField
            size="small"
            fullWidth
            label="External / Tracking Reference"
            value={submission.reference}
            onChange={(event) => setSubmission((current) => ({ ...current, reference: event.target.value }))}
            sx={{ mt: 0.6 }}
          />
        </Paper>
      )}

      <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
        {packageEditable && (
          <Button size="small" variant="outlined" onClick={() => update(priorAuthCase.status)} disabled={Boolean(busy)}>
            Save Case
          </Button>
        )}
        {["REQUIRED", "DRAFT"].includes(priorAuthCase.status) && (
          <Button size="small" variant="contained" onClick={() => update("READY")} disabled={Boolean(busy)}>
            Mark Package Ready
          </Button>
        )}
        {priorAuthCase.status === "READY" && (
          <Button size="small" variant="contained" onClick={recordSubmission} disabled={Boolean(busy)}>
            {busy === "submit" ? "Recording..." : "Record External Submission"}
          </Button>
        )}
        {awaitingDecision && priorAuthCase.status !== "PENDING" && (
          <Button size="small" variant="outlined" onClick={() => update("PENDING")} disabled={Boolean(busy)}>
            Mark Pending
          </Button>
        )}
        {awaitingDecision && priorAuthCase.status !== "ADDITIONAL_INFO" && (
          <Button size="small" variant="outlined" onClick={() => update("ADDITIONAL_INFO")} disabled={Boolean(busy)}>
            Additional Info Requested
          </Button>
        )}
        {awaitingDecision && (
          <>
            <Button size="small" color="success" variant="contained" onClick={() => update("APPROVED")} disabled={Boolean(busy) || !form.authorizationNo.trim()}>
              Approve
            </Button>
            <Button size="small" color="error" variant="outlined" onClick={() => update("DENIED")} disabled={Boolean(busy)}>
              Deny
            </Button>
          </>
        )}
      </Stack>

      {priorAuthCase.submittedAt && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          Submitted {dateOnly(priorAuthCase.submittedAt)} · {display(priorAuthCase.submissionChannel)} · {priorAuthCase.externalReference || "No reference"}
        </Typography>
      )}
    </Paper>
  );
}
