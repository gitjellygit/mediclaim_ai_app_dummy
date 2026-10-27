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
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { IntegrationsApi } from "../../api/integrations.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { useToast } from "../../context/ToastContext.jsx";

const EMPTY_FORM = {
  name: "",
  kind: "EHR",
  provider: "",
  environment: "SANDBOX"
};

function statusColor(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DEGRADED") return "warning";
  if (status === "ERROR") return "error";
  return "default";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function IntegrationHub() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canManage = hasPermission(user, PERMISSIONS.INTEGRATION_MANAGE);

  const [connections, setConnections] = React.useState([]);
  const [adapters, setAdapters] = React.useState([]);
  const [resourceTypes, setResourceTypes] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [records, setRecords] = React.useState([]);
  const [recordType, setRecordType] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [recordsLoading, setRecordsLoading] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [connectionData, adapterData] = await Promise.all([
        IntegrationsApi.list(),
        IntegrationsApi.adapters()
      ]);
      setConnections(connectionData.items || []);
      setAdapters(adapterData.adapters || []);
      setResourceTypes(adapterData.resourceTypes || []);
    } catch (error) {
      showToast(error?.message || "Unable to load integration connections.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function loadRecords(connection, nextType = recordType) {
    setSelected(connection);
    setRecordsLoading(true);
    try {
      const data = await IntegrationsApi.records(connection.id, {
        resourceType: nextType,
        limit: 50
      });
      setRecords(data.items || []);
    } catch (error) {
      showToast(error?.message || "Unable to load integration records.", "error");
    } finally {
      setRecordsLoading(false);
    }
  }

  async function createConnection() {
    if (!form.name.trim() || !form.provider.trim()) {
      showToast("Name and provider are required.", "warning");
      return;
    }
    setSaving(true);
    try {
      await IntegrationsApi.create({
        name: form.name.trim(),
        kind: form.kind,
        provider: form.provider.trim(),
        environment: form.environment
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      showToast("Integration connection created.", "success");
      await load();
    } catch (error) {
      showToast(error?.message || "Unable to create integration connection.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Integration Hub
          </Typography>
          <Typography color="text.secondary">
            Connect PRISM to EHR, practice-management, clearinghouse and payer data sources.
          </Typography>
        </Box>
        {canManage && (
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
            Add Connection
          </Button>
        )}
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Integration Hub normalizes source data into one PRISM model. FHIR R4, HL7 v2 and
        canonical JSON are supported today; vendor-specific adapters can plug into the same
        contract. Raw clinical payloads are not exposed in this dashboard.
      </Alert>

      <Card sx={{ mb: 2.5 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>
            Connections
          </Typography>
          {loading ? (
            <Typography color="text.secondary">Loading integrations…</Typography>
          ) : connections.length === 0 ? (
            <Typography color="text.secondary">
              No integration connections configured yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Environment</TableCell>
                  <TableCell>Health</TableCell>
                  <TableCell align="right">Records / Events</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {connections.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography fontWeight={700}>{item.name}</Typography>
                    </TableCell>
                    <TableCell>{item.kind}</TableCell>
                    <TableCell>{item.provider}</TableCell>
                    <TableCell>{item.environment}</TableCell>
                    <TableCell>
                      <Chip size="small" color={statusColor(item.status)} label={item.status} />
                    </TableCell>
                    <TableCell align="right">
                      {(item._count?.externalIdentities || 0) + " links / " +
                        (item._count?.events || 0) + " events"}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => loadRecords(item)}>
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Stack direction={{ xs: "column", xl: "row" }} spacing={2.5} alignItems="stretch">
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={800}>
              Adapter Catalog
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Transport and normalization capabilities available to source connectors.
            </Typography>
            <Stack spacing={1.25}>
              {adapters.map((adapter) => (
                <Box key={adapter.id}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={700}>{adapter.label}</Typography>
                    {adapter.transports.map((transport) => (
                      <Chip key={transport} size="small" variant="outlined" label={transport} />
                    ))}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {adapter.resourceTypes.join(" • ")}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1.4 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1.25 }}
            >
              <Box>
                <Typography variant="h6" fontWeight={800}>
                  Canonical Records
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selected
                    ? "Latest normalized metadata from " + selected.name
                    : "Select a connection to inspect normalized records."}
                </Typography>
              </Box>
              {selected && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Resource Type</InputLabel>
                  <Select
                    label="Resource Type"
                    value={recordType}
                    onChange={(event) => {
                      const next = event.target.value;
                      setRecordType(next);
                      void loadRecords(selected, next);
                    }}
                  >
                    <MenuItem value="">All</MenuItem>
                    {resourceTypes.map((type) => (
                      <MenuItem key={type} value={type}>{type}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Stack>
            <Divider sx={{ mb: 1.25 }} />
            {!selected ? null : recordsLoading ? (
              <Typography color="text.secondary">Loading records…</Typography>
            ) : records.length === 0 ? (
              <Typography color="text.secondary">No canonical records found.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Linked Claim</TableCell>
                    <TableCell>Last Seen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell><Chip size="small" label={record.resourceType} /></TableCell>
                      <TableCell>{record.sourceFormat + (record.sourceType ? " / " + record.sourceType : "")}</TableCell>
                      <TableCell>{record.claimId || "—"}</TableCell>
                      <TableCell>{formatDate(record.lastSeenAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add Integration Connection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Connection Name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <FormControl>
              <InputLabel>Connection Type</InputLabel>
              <Select
                label="Connection Type"
                value={form.kind}
                onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
              >
                {["EHR", "PMS", "CLEARINGHOUSE", "PAYER", "HIE", "DATA_WAREHOUSE", "OTHER"].map((kind) => (
                  <MenuItem key={kind} value={kind}>{kind}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Provider"
              placeholder="Epic, athenahealth, Oracle Health, custom interface…"
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
            <FormControl>
              <InputLabel>Environment</InputLabel>
              <Select
                label="Environment"
                value={form.environment}
                onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
              >
                {["SANDBOX", "TEST", "PRODUCTION"].map((environment) => (
                  <MenuItem key={environment} value={environment}>{environment}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={createConnection} disabled={saving}>
            {saving ? "Creating…" : "Create Connection"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
