import React from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField
} from "@mui/material";
import { ClaimsApi } from "../api/claims.js";
import { OperationsApi } from "../api/operations.js";
import { roleLabel } from "../utils/displayLabels.js";

export default function ClaimAssignmentDialog({
  open,
  claimIds = [],
  currentAssigneeId = "",
  currentTeam = "",
  title = "Assign claim",
  loadUsers,
  saveAssignment,
  onClose,
  onSaved
}) {
  const [users, setUsers] = React.useState([]);
  const [teams, setTeams] = React.useState([]);
  const bulkMode = claimIds.length > 1;
  const [assigneeId, setAssigneeId] = React.useState("");
  const [team, setTeam] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setAssigneeId(bulkMode ? "__NO_CHANGE__" : currentAssigneeId || "");
    setTeam(bulkMode ? "__NO_CHANGE__" : currentTeam || "");
    setError("");
    setLoading(true);
    Promise.all([
      (loadUsers || ClaimsApi.workManagementUsers)(),
      OperationsApi.teams()
    ])
      .then(([result, teamResult]) => {
        setUsers(Array.isArray(result?.items) ? result.items : []);
        setTeams(Array.isArray(teamResult?.items) ? teamResult.items : []);
      })
      .catch((e) => setError(e?.message || "Assignment options could not be loaded."))
      .finally(() => setLoading(false));
  }, [open, currentAssigneeId, currentTeam, bulkMode, loadUsers]);

  async function save() {
    if (!claimIds.length) return;
    try {
      setSaving(true);
      setError("");
      const payload = { claimIds };
      if (assigneeId !== "__NO_CHANGE__") {
        payload.assignedToUserId = assigneeId || null;
      }
      if (team !== "__NO_CHANGE__") {
        payload.workTeam = team || null;
      }
      if (saveAssignment) {
        await saveAssignment(payload);
      } else {
        await OperationsApi.bulkWork(payload);
      }
      await onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || "Assignment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose?.()} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {claimIds.length > 1 && (
            <Alert severity="info">
              This will update {claimIds.length} selected claims and write the change to ownership history.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <FormControl size="small" fullWidth disabled={loading || saving}>
            <InputLabel>Assigned Owner</InputLabel>
            <Select
              label="Assigned Owner"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              {bulkMode && <MenuItem value="__NO_CHANGE__">No assignment change</MenuItem>}
              <MenuItem value="">Unassigned</MenuItem>
              {users.map((person) => (
                <MenuItem key={person.id} value={person.id}>
                  {person.displayName || person.email} · {String(person.role || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase())}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={loading || saving}>
            <InputLabel>Work Team</InputLabel>
            <Select
              label="Work Team"
              value={team}
              onChange={(event) => setTeam(event.target.value)}
            >
              {bulkMode && <MenuItem value="__NO_CHANGE__">No team change</MenuItem>}
              <MenuItem value="">No team</MenuItem>
              {teams.map((item) => (
                <MenuItem key={item.id} value={item.name}>{item.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || loading || !claimIds.length}>
          {saving ? "Saving..." : "Save Assignment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
