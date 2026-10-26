import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { ContentCopy, Refresh } from "@mui/icons-material";
import { OperationsApi } from "../../api/operations.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { formatUSD } from "../../utils/currency.js";
import { humanizeEnum, roleLabel } from "../../utils/displayLabels.js";

function dateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("en-US");
}

export default function Operations() {
  const { user } = useAuth();
  const { showDialog } = useToast();
  const isAdmin = hasPermission(user, PERMISSIONS.USER_ADMIN);
  const isManager = ["ADMIN", "CLAIMS_MANAGER"].includes(user?.role);
  const canClinical = hasPermission(user, PERMISSIONS.CLINICAL_VIEW);

  const tabs = [
    ...(isAdmin ? [{ key: "users", label: "Users & Teams" }] : []),
    ...(isManager ? [{ key: "workload", label: "Team Workload" }] : []),
    ...(canClinical ? [{ key: "clinical", label: user?.role === "PROVIDER" ? "My Clinical Requests" : "Clinical Requests" }] : []),
    ...(isManager ? [{ key: "approvals", label: "Approvals" }] : []),
    { key: "notifications", label: "Notifications" }
  ];

  const [tab, setTab] = React.useState(tabs[0]?.key || "notifications");
  const [loading, setLoading] = React.useState(false);
  const [users, setUsers] = React.useState([]);
  const [teams, setTeams] = React.useState([]);
  const [roles, setRoles] = React.useState([]);
  const [workload, setWorkload] = React.useState([]);
  const [clinical, setClinical] = React.useState([]);
  const [approvals, setApprovals] = React.useState([]);
  const [notifications, setNotifications] = React.useState([]);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState("");
  const [invite, setInvite] = React.useState({ email: "", displayName: "", role: "CLAIMS_SPECIALIST", teamId: "" });
  const [teamDraft, setTeamDraft] = React.useState({ name: "", description: "" });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const jobs = [];
      if (isAdmin) jobs.push(Promise.all([OperationsApi.users(), OperationsApi.teams(), OperationsApi.roles()]).then(([u,t,r]) => {
        setUsers(u?.items || []); setTeams(t?.items || []); setRoles(r?.items || []);
      }));
      else jobs.push(OperationsApi.teams().then((t) => setTeams(t?.items || [])).catch(() => {}));
      if (isManager) {
        jobs.push(OperationsApi.workload().then((r) => setWorkload(r?.items || [])));
        jobs.push(OperationsApi.approvals("PENDING").then((r) => setApprovals(r?.items || [])));
      }
      if (canClinical) {
        jobs.push(OperationsApi.clinicalRequests({ mine: user?.role === "PROVIDER" }).then((r) => setClinical(r?.items || [])));
      }
      jobs.push(OperationsApi.notifications().then((r) => setNotifications(r?.items || [])));
      await Promise.all(jobs);
    } catch (error) {
      showDialog(error?.message || "Operations data could not be loaded.", { title: "Operations", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isManager, canClinical, user?.role, showDialog]);

  React.useEffect(() => { load(); }, [load]);

  async function sendInvite() {
    try {
      const result = await OperationsApi.inviteUser({
        email: invite.email,
        displayName: invite.displayName || null,
        role: invite.role,
        teamId: invite.teamId || null
      });
      const activationUrl = new URL("/accept-invite", window.location.origin);
      activationUrl.searchParams.set("token", result.setupToken || "");
      setInviteLink(activationUrl.toString());
      setInviteOpen(false);
      await load();
    } catch (error) {
      showDialog(error?.message || "User could not be invited.", { title: "Invite failed", severity: "error" });
    }
  }

  async function createTeam() {
    try {
      await OperationsApi.createTeam(teamDraft);
      setTeamDraft({ name: "", description: "" });
      setTeamOpen(false);
      await load();
    } catch (error) {
      showDialog(error?.message || "Team could not be created.", { title: "Team", severity: "error" });
    }
  }

  async function updateUser(id, patch) {
    try {
      await OperationsApi.updateUser(id, patch);
      await load();
    } catch (error) {
      showDialog(error?.message || "User could not be updated.", { title: "User update", severity: "error" });
    }
  }

  async function decideApproval(id, decision) {
    const reason =
      decision === "APPROVED"
        ? null
        : window.prompt(decision === "REJECTED" ? "Reason for rejection" : "Reason for return");
    if (decision !== "APPROVED" && !reason?.trim()) return;
    try {
      await OperationsApi.decideApproval(id, {
        decision,
        reason: reason?.trim() || null
      });
      await load();
    } catch (error) {
      showDialog(error?.message || "Approval decision failed.", { title: "Approval", severity: "error" });
    }
  }

  async function respondClinical(item, status) {
    const responseText = window.prompt(status === "RESPONDED" ? "Clinical response" : "Reason unable to complete");
    if (!responseText?.trim()) return;
    try {
      await OperationsApi.respondClinicalRequest(item.id, { responseText: responseText.trim(), status });
      await load();
    } catch (error) {
      showDialog(error?.message || "Clinical request could not be updated.", { title: "Clinical request", severity: "error" });
    }
  }

  return (
    <Box sx={{ py: 1.5 }} data-testid="operations-page">
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} spacing={1} sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={850}>Operations & Team Management</Typography>
          <Typography variant="body2" color="text.secondary">
            Role-based staffing, clinical collaboration, approvals, notifications and workload oversight.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={load} disabled={loading}>Refresh</Button>
      </Stack>

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
        {tabs.map((item) => <Tab key={item.key} value={item.key} label={item.label} />)}
      </Tabs>

      {tab === "users" && isAdmin && (
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={0.75}>
            <Button variant="contained" onClick={() => setInviteOpen(true)}>Invite User</Button>
            <Button variant="outlined" onClick={() => setTeamOpen(true)}>Create Team</Button>
          </Stack>
          {inviteLink && (
            <Alert severity="success" action={
              <Button size="small" startIcon={<ContentCopy />} onClick={() => window.navigator.clipboard?.writeText(inviteLink)}>Copy activation link</Button>
            }>
              Invitation created. Share the secure activation link with the invited user. The one-time token is not displayed on screen.
            </Alert>
          )}
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell><b>User</b></TableCell><TableCell><b>Role</b></TableCell><TableCell><b>Team</b></TableCell>
                <TableCell><b>Status</b></TableCell><TableCell><b>Assigned</b></TableCell><TableCell><b>Last login</b></TableCell>
              </TableRow></TableHead>
              <TableBody>
                {users.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.displayName || item.email}<Typography variant="caption" display="block" color="text.secondary">{item.email}</Typography></TableCell>
                    <TableCell>
                      <Select size="small" value={item.role} onChange={(e) => updateUser(item.id, { role: e.target.value })}>
                        {roles.map((role) => <MenuItem key={role} value={role}>{roleLabel(role)}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select size="small" displayEmpty value={item.teamId || ""} onChange={(e) => updateUser(item.id, { teamId: e.target.value || null })}>
                        <MenuItem value="">No team</MenuItem>
                        {teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select size="small" value={item.status} disabled={item.status === "INVITED" || item.id === user?.id} onChange={(e) => updateUser(item.id, { status: e.target.value })}>
                        {item.status === "INVITED" && <MenuItem value="INVITED">Invited</MenuItem>}
                        <MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="SUSPENDED">Suspended</MenuItem>
                      </Select>
                    </TableCell>
                    <TableCell>{item._count?.assignedClaims ?? 0}</TableCell>
                    <TableCell>{dateTime(item.lastLoginAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle1" fontWeight={800}>Teams</Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              {teams.map((team) => <Chip key={team.id} label={`${team.name} · ${team._count?.users || 0} users`} />)}
            </Stack>
          </Paper>
        </Stack>
      )}

      {tab === "workload" && isManager && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell><b>Staff</b></TableCell><TableCell><b>Role / Team</b></TableCell>
              <TableCell align="right"><b>Open</b></TableCell><TableCell align="right"><b>Overdue</b></TableCell>
              <TableCell align="right"><b>Urgent</b></TableCell><TableCell align="right"><b>Escalated</b></TableCell>
            </TableRow></TableHead>
            <TableBody>
              {workload.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.displayName || item.email}<Typography variant="caption" display="block" color="text.secondary">{item.email}</Typography></TableCell>
                  <TableCell>{roleLabel(item.role)}{item.team ? ` · ${item.team}` : ""}</TableCell>
                  <TableCell align="right">{item.open}</TableCell>
                  <TableCell align="right"><Typography color={item.overdue ? "error.main" : "text.primary"}>{item.overdue}</Typography></TableCell>
                  <TableCell align="right">{item.urgent}</TableCell><TableCell align="right">{item.escalated}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === "clinical" && canClinical && (
        <Stack spacing={1}>
          {clinical.length === 0 && <Alert severity="info">No clinical requests match this view.</Alert>}
          {clinical.map((item) => (
            <Card key={item.id} variant="outlined">
              <CardContent>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                  <Box>
                    <Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
                      <Chip size="small" label={humanizeEnum(item.status)} />
                      <Chip size="small" variant="outlined" label={roleLabel(item.requestType)} />
                    </Stack>
                    <Typography fontWeight={800}>{item.claim?.patientName} · {item.claim?.payerName}</Typography>
                    <Typography variant="body2">{item.requestText}</Typography>
                    <Typography variant="caption" color="text.secondary">Due: {dateTime(item.dueAt)} · Claim amount: {formatUSD(item.claim?.amount)}</Typography>
                  </Box>
                  {item.status === "OPEN" && (
                    <Stack direction="row" spacing={0.75} alignItems="flex-start">
                      <Button size="small" variant="contained" onClick={() => respondClinical(item, "RESPONDED")}>Respond</Button>
                      <Button size="small" variant="outlined" onClick={() => respondClinical(item, "UNABLE_TO_COMPLETE")}>Unable</Button>
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {tab === "approvals" && isManager && (
        <Stack spacing={1}>
          {approvals.length === 0 && <Alert severity="info">No pending manager approvals.</Alert>}
          {approvals.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography fontWeight={800}>{roleLabel(item.requestType)} · {item.claim?.patientName}</Typography>
                  <Typography variant="body2">{item.reason}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Requested by {item.requestedByUser?.displayName || item.requestedByUser?.email}
                    {item.amount != null ? ` · ${formatUSD(item.amount)}` : ""}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75}>
                  <Button size="small" variant="contained" onClick={() => decideApproval(item.id, "APPROVED")}>Approve</Button>
                  <Button size="small" color="error" variant="outlined" onClick={() => decideApproval(item.id, "REJECTED")}>Reject</Button>
                  <Button size="small" variant="text" onClick={() => decideApproval(item.id, "RETURNED")}>Return</Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {tab === "notifications" && (
        <Stack spacing={0.75}>
          {notifications.length === 0 && <Alert severity="info">No notifications yet.</Alert>}
          {notifications.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1, opacity: item.readAt ? 0.65 : 1 }}>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography fontWeight={item.readAt ? 600 : 800}>{item.title}</Typography>
                  <Typography variant="body2">{item.message}</Typography>
                  <Typography variant="caption" color="text.secondary">{dateTime(item.createdAt)}</Typography>
                </Box>
                {!item.readAt && <Button size="small" onClick={async () => { await OperationsApi.markNotificationRead(item.id); await load(); }}>Mark read</Button>}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Invite User</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ mt: 0.5 }}>
            <TextField label="Name" value={invite.displayName} onChange={(e) => setInvite((c) => ({ ...c, displayName: e.target.value }))} />
            <TextField label="Email" value={invite.email} onChange={(e) => setInvite((c) => ({ ...c, email: e.target.value }))} />
            <FormControl><InputLabel>Role</InputLabel><Select label="Role" value={invite.role} onChange={(e) => setInvite((c) => ({ ...c, role: e.target.value }))}>
              {roles.map((role) => <MenuItem key={role} value={role}>{roleLabel(role)}</MenuItem>)}
            </Select></FormControl>
            <FormControl><InputLabel>Team</InputLabel><Select label="Team" value={invite.teamId} onChange={(e) => setInvite((c) => ({ ...c, teamId: e.target.value }))}>
              <MenuItem value="">No team</MenuItem>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
            </Select></FormControl>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setInviteOpen(false)}>Cancel</Button><Button variant="contained" onClick={sendInvite} disabled={!invite.email || !invite.role}>Send Invite</Button></DialogActions>
      </Dialog>

      <Dialog open={teamOpen} onClose={() => setTeamOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Team</DialogTitle>
        <DialogContent><Stack spacing={1.25} sx={{ mt: 0.5 }}>
          <TextField label="Team Name" value={teamDraft.name} onChange={(e) => setTeamDraft((c) => ({ ...c, name: e.target.value }))} />
          <TextField label="Description" value={teamDraft.description} onChange={(e) => setTeamDraft((c) => ({ ...c, description: e.target.value }))} />
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setTeamOpen(false)}>Cancel</Button><Button variant="contained" onClick={createTeam} disabled={!teamDraft.name.trim()}>Create</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
