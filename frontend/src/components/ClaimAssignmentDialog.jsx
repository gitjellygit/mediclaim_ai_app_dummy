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

export default function ClaimAssignmentDialog({
  open,
  claimIds = [],
  currentAssigneeId = "",
  currentTeam = "",
  title = "Assign claim",
  onClose,
  onSaved
}) {
  const [users, setUsers] = React.useState([]);
  const [assigneeId, setAssigneeId] = React.useState("");
  const [team, setTeam] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setAssigneeId(currentAssigneeId || "");
    setTeam(currentTeam || "");
    setError("");
    setLoading(true);
    ClaimsApi.workManagementUsers()
      .then((result) => setUsers(Array.isArray(result?.items) ? result.items : []))
      .catch((e) => setError(e?.message || "Assignable users could not be loaded."))
      .finally(() => setLoading(false));
  }, [open, currentAssigneeId, currentTeam]);

  async function save() {
    if (!claimIds.length) return;
    try {
      setSaving(true);
      setError("");
      await OperationsApi.bulkWork({
        claimIds,
        assignedToUserId: assigneeId || null,
        workTeam: team.trim() || null
      });
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
            <InputLabel>Assigned Specialist</InputLabel>
            <Select
              label="Assigned Specialist"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {users.map((person) => (
                <MenuItem key={person.id} value={person.id}>
                  {person.displayName || person.email} · {person.role}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Work Team"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            disabled={saving}
            helperText="Optional operational team label"
          />
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
