import React from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, IconButton,
  MenuItem, Pagination, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography
} from "@mui/material";
import {
  Download as DownloadIcon,
  ExpandLess,
  ExpandMore,
  FilterAltOff
} from "@mui/icons-material";
import { AuditApi } from "../../api/audit.js";
import { useLocation } from "react-router-dom";

const OUTCOMES = ["", "SUCCESS", "DENIED", "FAILURE"];
const ENTITY_TYPES = ["", "Claim", "Document", "Session", "User", "Rule", "DenialCase", "UnderpaymentCase", "AuditEvent"];
const METHODS = ["", "GET", "POST", "PATCH", "PUT", "DELETE"];

function actionLabel(value = "") {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function apiFilters(filters) {
  const result = { ...filters };
  if (filters.from) result.from = new Date(filters.from).toISOString();
  if (filters.to) result.to = new Date(filters.to).toISOString();
  return result;
}

function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function DetailLine({ label, value }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{value || "—"}</Typography>
    </Box>
  );
}

export default function AuditTrail() {
  const location = useLocation();
  const initialClaimId = new URLSearchParams(location.search).get("claimId") || "";
  const [data, setData] = React.useState({ items: [], total: 0, page: 1, pageSize: 25 });
  const [filters, setFilters] = React.useState({
    from: "",
    to: "",
    actorEmail: "",
    action: "",
    outcome: "",
    entityType: "",
    claimId: initialClaimId,
    entityId: "",
    ipAddress: "",
    requestId: "",
    httpMethod: "",
    statusCode: ""
  });
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expandedRows, setExpandedRows] = React.useState(new Set());

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    AuditApi.list({ ...apiFilters(filters), page, pageSize: 25 })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err.message || "Unable to load audit trail");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, page]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({
      from: "", to: "", actorEmail: "", action: "", outcome: "", entityType: "",
      claimId: "", entityId: "", ipAddress: "", requestId: "", httpMethod: "", statusCode: ""
    });
    setPage(1);
  }

  function toggleRow(id) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const result = await AuditApi.exportCsv(apiFilters(filters));
      downloadText(result.filename || "audit-trail.csv", result.csv || "");
      if (result.truncated) {
        setError(`Export reached the ${result.limit} row safety limit. Narrow the filters for a complete export.`);
      }
    } catch (err) {
      setError(err.message || "Unable to export audit trail");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 1600, mx: "auto", py: 3 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={2}
        >
          <Box>
            <Typography variant="h4" fontWeight={800}>Audit Trail</Typography>
            <Typography color="text.secondary">
              Organization security and PHI-access history. Request context is recorded without copying
              patient names, diagnoses, member IDs, document filenames, or other claim PHI into audit metadata.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={exportCsv}
            disabled={exporting}
          >
            {exporting ? "Preparing..." : "Download CSV"}
          </Button>
        </Stack>

        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>
              Filters
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, minmax(0, 1fr))",
                  lg: "repeat(4, minmax(0, 1fr))"
                },
                gap: 1.5
              }}
            >
              <TextField
                type="datetime-local"
                label="From"
                InputLabelProps={{ shrink: true }}
                value={filters.from}
                onChange={(e) => updateFilter("from", e.target.value)}
                size="small"
              />
              <TextField
                type="datetime-local"
                label="To"
                InputLabelProps={{ shrink: true }}
                value={filters.to}
                onChange={(e) => updateFilter("to", e.target.value)}
                size="small"
              />
              <TextField
                label="User email"
                placeholder="admin@clinic.com"
                value={filters.actorEmail}
                onChange={(e) => updateFilter("actorEmail", e.target.value)}
                size="small"
              />
              <TextField
                label="Action"
                placeholder="CLAIM_VIEWED"
                value={filters.action}
                onChange={(e) => updateFilter("action", e.target.value.toUpperCase())}
                size="small"
              />

              <TextField
                select label="Outcome" value={filters.outcome}
                onChange={(e) => updateFilter("outcome", e.target.value)} size="small"
              >
                {OUTCOMES.map((value) => (
                  <MenuItem key={value || "all"} value={value}>{value || "All outcomes"}</MenuItem>
                ))}
              </TextField>
              <TextField
                select label="Entity" value={filters.entityType}
                onChange={(e) => updateFilter("entityType", e.target.value)} size="small"
              >
                {ENTITY_TYPES.map((value) => (
                  <MenuItem key={value || "all"} value={value}>{value || "All entities"}</MenuItem>
                ))}
              </TextField>
              <TextField
                select label="HTTP method" value={filters.httpMethod}
                onChange={(e) => updateFilter("httpMethod", e.target.value)} size="small"
              >
                {METHODS.map((value) => (
                  <MenuItem key={value || "all"} value={value}>{value || "All methods"}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="HTTP status"
                placeholder="200"
                value={filters.statusCode}
                onChange={(e) => updateFilter("statusCode", e.target.value.replace(/\D/g, "").slice(0, 3))}
                size="small"
              />

              <TextField
                label="Claim ID"
                value={filters.claimId}
                onChange={(e) => updateFilter("claimId", e.target.value.trim())}
                size="small"
              />
              <TextField
                label="Entity ID"
                value={filters.entityId}
                onChange={(e) => updateFilter("entityId", e.target.value.trim())}
                size="small"
              />
              <TextField
                label="IP address"
                value={filters.ipAddress}
                onChange={(e) => updateFilter("ipAddress", e.target.value.trim())}
                size="small"
              />
              <TextField
                label="Request ID"
                value={filters.requestId}
                onChange={(e) => updateFilter("requestId", e.target.value.trim())}
                size="small"
              />
            </Box>

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {data.total.toLocaleString()} matching event{data.total === 1 ? "" : "s"}
              </Typography>
              <Button size="small" startIcon={<FilterAltOff />} onClick={clearFilters}>
                Clear filters
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {error && <Alert severity={error.includes("safety limit") ? "warning" : "error"}>{error}</Alert>}

        <Card>
          <CardContent sx={{ p: 0 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={44} />
                    <TableCell>When</TableCell>
                    <TableCell>User</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Request</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!loading && data.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">No audit events match these filters.</TableCell>
                    </TableRow>
                  )}
                  {data.items.map((item) => {
                    const expanded = expandedRows.has(item.id);
                    return (
                      <React.Fragment key={item.id}>
                        <TableRow hover>
                          <TableCell>
                            <Tooltip title={expanded ? "Hide details" : "View details"}>
                              <IconButton size="small" onClick={() => toggleRow(item.id)}>
                                {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {new Date(item.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {item.actor?.email || "System"}
                            {item.actor?.role && (
                              <Typography variant="caption" display="block" color="text.secondary">
                                {item.actor.role}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{actionLabel(item.action)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700}>{item.entityType}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.entityId || item.claimId || "—"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={item.outcome}
                              color={item.outcome === "SUCCESS" ? "success" : item.outcome === "DENIED" ? "warning" : "error"}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {[item.httpMethod, item.statusCode].filter(Boolean).join(" • ") || "—"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.ipAddress || "IP unavailable"}
                            </Typography>
                          </TableCell>
                        </TableRow>

                        <TableRow>
                          <TableCell colSpan={7} sx={{ p: 0, borderBottom: expanded ? undefined : 0 }}>
                            <Collapse in={expanded} timeout="auto" unmountOnExit>
                              <Box
                                sx={{
                                  p: 2,
                                  backgroundColor: "grey.50",
                                  display: "grid",
                                  gridTemplateColumns: {
                                    xs: "1fr",
                                    md: "repeat(3, minmax(0, 1fr))"
                                  },
                                  gap: 1.5
                                }}
                              >
                                <DetailLine label="Claim ID" value={item.claimId} />
                                <DetailLine label="Entity ID" value={item.entityId} />
                                <DetailLine label="IP address" value={item.ipAddress} />
                                <DetailLine label="HTTP method" value={item.httpMethod} />
                                <DetailLine label="HTTP route" value={item.httpPath} />
                                <DetailLine label="HTTP status" value={item.statusCode} />
                                <DetailLine label="Request ID" value={item.requestId} />
                                <Box sx={{ gridColumn: { md: "span 2" } }}>
                                  <DetailLine label="User agent" value={item.userAgent} />
                                </Box>
                                <Box sx={{ gridColumn: "1 / -1" }}>
                                  <DetailLine
                                    label="Safe operational metadata"
                                    value={
                                      Object.keys(item.metadata || {}).length
                                        ? JSON.stringify(item.metadata, null, 2)
                                        : "—"
                                    }
                                  />
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        {data.total > data.pageSize && (
          <Pagination
            count={Math.ceil(data.total / data.pageSize)}
            page={page}
            onChange={(_event, value) => setPage(value)}
            sx={{ alignSelf: "center" }}
          />
        )}
      </Stack>
    </Box>
  );
}
