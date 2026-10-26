import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { ClaimsApi } from "../../api/claims.js";
import { OperationsApi } from "../../api/operations.js";
import { humanizeEnum } from "../../utils/displayLabels.js";

function dt(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("en-US");
}

function label(value) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ClaimCollaboration({ claimId, canEdit = false }) {
  const [comments, setComments] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [users, setUsers] = React.useState([]);
  const [clinical, setClinical] = React.useState([]);
  const [body, setBody] = React.useState("");
  const [mentionUserId, setMentionUserId] = React.useState("");
  const [clinicalDraft, setClinicalDraft] = React.useState({
    requestType: "MISSING_DOCUMENTATION",
    requestText: "",
    assignedToUserId: "",
    dueAt: ""
  });
  const [approvalDraft, setApprovalDraft] = React.useState({
    requestType: "WRITE_OFF",
    amount: "",
    reason: ""
  });
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    if (!claimId) return;
    const jobs = [
      OperationsApi.comments(claimId).then((r) => setComments(r?.items || [])),
      OperationsApi.ownershipHistory(claimId).then((r) => setHistory(r?.items || [])),
      OperationsApi.clinicalRequests().then((r) =>
        setClinical((r?.items || []).filter((item) => item.claimId === claimId))
      )
    ];
    if (canEdit) {
      jobs.push(
        ClaimsApi.workManagementUsers()
          .then((r) => setUsers(r?.items || []))
          .catch(() => setUsers([]))
      );
    }
    await Promise.all(jobs);
  }, [claimId, canEdit]);

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function addComment() {
    if (!body.trim()) return;
    await OperationsApi.addComment(claimId, {
      body: body.trim(),
      mentionUserIds: mentionUserId ? [mentionUserId] : []
    });
    setBody("");
    setMentionUserId("");
    setMessage("Comment added.");
    await load();
  }

  async function createClinical() {
    if (!clinicalDraft.requestText.trim()) return;
    await OperationsApi.createClinicalRequest({
      claimId,
      requestType: clinicalDraft.requestType,
      requestText: clinicalDraft.requestText.trim(),
      assignedToUserId: clinicalDraft.assignedToUserId || null,
      dueAt: clinicalDraft.dueAt
        ? new Date(`${clinicalDraft.dueAt}T23:59:59.000Z`).toISOString()
        : null
    });
    setClinicalDraft({
      requestType: "MISSING_DOCUMENTATION",
      requestText: "",
      assignedToUserId: "",
      dueAt: ""
    });
    setMessage("Clinical request created.");
    await load();
  }

  async function requestApproval() {
    const financialApproval = ["WRITE_OFF", "LARGE_ADJUSTMENT"].includes(approvalDraft.requestType);
    if (!approvalDraft.reason.trim()) return;
    if (financialApproval && !(Number(approvalDraft.amount) > 0)) {
      setMessage("Enter a positive amount for this financial approval.");
      return;
    }
    await OperationsApi.createApproval({
      claimId,
      requestType: approvalDraft.requestType,
      amount: approvalDraft.amount === "" ? null : Number(approvalDraft.amount),
      reason: approvalDraft.reason.trim()
    });
    setApprovalDraft({ requestType: "WRITE_OFF", amount: "", reason: "" });
    setMessage("Manager approval requested.");
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="claim-collaboration">
      <Typography variant="h6" fontWeight={850}>Operational Collaboration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
        Keep claim follow-up, clinical clarification and ownership decisions inside PRISM.
      </Typography>

      {message && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setMessage("")}>{message}</Alert>}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1.3fr 1fr" }, gap: 1.25 }}>
        <Stack spacing={1.25}>
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Internal Comments</Typography>
            <Stack spacing={0.75} sx={{ mt: 0.75 }}>
              {comments.length === 0 && <Typography variant="body2" color="text.secondary">No operational comments yet.</Typography>}
              {comments.slice(-8).map((item) => (
                <Box key={item.id} sx={{ p: 0.9, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Typography variant="body2">{item.body}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.authorUser?.displayName || item.authorUser?.email} · {dt(item.createdAt)}
                  </Typography>
                </Box>
              ))}
              {canEdit && (
                <>
                  <TextField size="small" multiline minRows={2} label="Add operational comment" value={body} onChange={(e) => setBody(e.target.value)} />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Mention</InputLabel>
                      <Select label="Mention" value={mentionUserId} onChange={(e) => setMentionUserId(e.target.value)}>
                        <MenuItem value="">No mention</MenuItem>
                        {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.email}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <Button variant="contained" onClick={addComment} disabled={!body.trim()}>Add Comment</Button>
                  </Stack>
                </>
              )}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Clinical Requests</Typography>
            <Stack spacing={0.75} sx={{ mt: 0.75 }}>
              {clinical.length === 0 && <Typography variant="body2" color="text.secondary">No clinical clarification requests.</Typography>}
              {clinical.map((item) => (
                <Box key={item.id} sx={{ p: 0.9, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Stack direction="row" spacing={0.5} sx={{ mb: 0.4 }}>
                    <Chip size="small" label={humanizeEnum(item.status)} />
                    <Chip size="small" variant="outlined" label={label(item.requestType)} />
                  </Stack>
                  <Typography variant="body2">{item.requestText}</Typography>
                  {item.responseText && <Typography variant="body2" color="success.main" sx={{ mt: 0.4 }}>Response: {item.responseText}</Typography>}
                  <Typography variant="caption" color="text.secondary">Due {dt(item.dueAt)}</Typography>
                </Box>
              ))}
              {canEdit && (
                <Stack spacing={0.75}>
                  <FormControl size="small">
                    <InputLabel>Request Type</InputLabel>
                    <Select label="Request Type" value={clinicalDraft.requestType} onChange={(e) => setClinicalDraft((c) => ({ ...c, requestType: e.target.value }))}>
                      {[
                        "MISSING_DOCUMENTATION","DIAGNOSIS_CLARIFICATION","PROCEDURE_JUSTIFICATION",
                        "MEDICAL_NECESSITY","OPERATIVE_NOTE","PROGRESS_NOTE","SIGNATURE_ATTESTATION",
                        "PRIOR_AUTH_EVIDENCE","OTHER"
                      ].map((v) => <MenuItem key={v} value={v}>{label(v)}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField size="small" label="What does the clinical team need?" value={clinicalDraft.requestText} onChange={(e) => setClinicalDraft((c) => ({ ...c, requestText: e.target.value }))} />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Clinical Assignee</InputLabel>
                      <Select label="Clinical Assignee" value={clinicalDraft.assignedToUserId} onChange={(e) => setClinicalDraft((c) => ({ ...c, assignedToUserId: e.target.value }))}>
                        <MenuItem value="">Unassigned</MenuItem>
                        {users.filter((u) => ["CLINICAL_REVIEWER","PROVIDER"].includes(u.role)).map((u) => <MenuItem key={u.id} value={u.id}>{u.email}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField size="small" type="date" label="Due" InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().slice(0, 10) }} value={clinicalDraft.dueAt} onChange={(e) => setClinicalDraft((c) => ({ ...c, dueAt: e.target.value }))} />
                    <Button variant="outlined" onClick={createClinical} disabled={!clinicalDraft.requestText.trim()}>Request</Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </Box>
        </Stack>

        <Stack spacing={1.25}>
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Ownership History</Typography>
            <Stack spacing={0.6} sx={{ mt: 0.75 }}>
              {history.length === 0 && <Typography variant="body2" color="text.secondary">No ownership changes recorded yet.</Typography>}
              {history.slice(0, 10).map((item) => (
                <Box key={item.id} sx={{ borderLeft: "2px solid", borderColor: "divider", pl: 1 }}>
                  <Typography variant="body2">
                    {item.previousAssigneeName || "Unassigned"} → {item.newAssigneeName || "Unassigned"}
                    {item.newPriority ? ` · Priority ${item.newPriority}` : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {dt(item.createdAt)} · {item.changedByUser?.displayName || item.changedByUser?.email || "System"}
                  </Typography>
                  {item.reason && <Typography variant="caption" display="block">{item.reason}</Typography>}
                </Box>
              ))}
            </Stack>
          </Box>

          {canEdit && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" fontWeight={800}>Request Manager Approval</Typography>
                <Typography variant="caption" color="text.secondary">
                  Use this for write-offs, large adjustments, closing recovery or exceptional overrides.
                </Typography>
                <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                  <FormControl size="small">
                    <InputLabel>Approval Type</InputLabel>
                    <Select label="Approval Type" value={approvalDraft.requestType} onChange={(e) => setApprovalDraft((c) => ({ ...c, requestType: e.target.value }))}>
                      {["WRITE_OFF","LARGE_ADJUSTMENT","CLOSE_RECOVERY","ABANDON_APPEAL","EXCEPTION_OVERRIDE"].map((v) => <MenuItem key={v} value={v}>{label(v)}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="number"
                    label={["WRITE_OFF", "LARGE_ADJUSTMENT"].includes(approvalDraft.requestType) ? "Amount *" : "Amount (optional)"}
                    inputProps={{ min: 0.01, step: 0.01 }}
                    value={approvalDraft.amount}
                    onChange={(e) => setApprovalDraft((c) => ({ ...c, amount: e.target.value }))}
                  />
                  <TextField size="small" multiline minRows={2} label="Reason" value={approvalDraft.reason} onChange={(e) => setApprovalDraft((c) => ({ ...c, reason: e.target.value }))} />
                  <Button
                    variant="outlined"
                    onClick={requestApproval}
                    disabled={
                      !approvalDraft.reason.trim() ||
                      (["WRITE_OFF", "LARGE_ADJUSTMENT"].includes(approvalDraft.requestType) && !(Number(approvalDraft.amount) > 0))
                    }
                  >
                    Request Approval
                  </Button>
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}
