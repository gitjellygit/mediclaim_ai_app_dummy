import React from "react";
import {
  Alert, Box, Card, CardContent, Chip, MenuItem, Pagination, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography
} from "@mui/material";
import { AuditApi } from "../../api/audit.js";

const OUTCOMES = ["", "SUCCESS", "DENIED", "FAILURE"];
const ENTITY_TYPES = ["", "Claim", "Document", "Session", "User", "Rule", "DenialCase", "UnderpaymentCase"];

function actionLabel(value = "") {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

export default function AuditTrail() {
  const [data, setData] = React.useState({ items: [], total: 0, page: 1, pageSize: 25 });
  const [filters, setFilters] = React.useState({
    action: "", outcome: "", entityType: "", claimId: ""
  });
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    AuditApi.list({ ...filters, page, pageSize: 25 })
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

  return (
    <Box sx={{ maxWidth: 1400, mx: "auto", py: 3 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Audit Trail</Typography>
          <Typography color="text.secondary">
            Security and PHI-access history for your organization. Audit metadata excludes patient names,
            document filenames, member IDs, diagnoses, and other PHI.
          </Typography>
        </Box>

        <Card>
          <CardContent>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
              <TextField
                label="Action"
                placeholder="e.g. CLAIM_VIEWED"
                value={filters.action}
                onChange={(e) => updateFilter("action", e.target.value.toUpperCase())}
                fullWidth
              />
              <TextField
                select
                label="Outcome"
                value={filters.outcome}
                onChange={(e) => updateFilter("outcome", e.target.value)}
                fullWidth
              >
                {OUTCOMES.map((value) => (
                  <MenuItem key={value || "all"} value={value}>{value || "All outcomes"}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Entity"
                value={filters.entityType}
                onChange={(e) => updateFilter("entityType", e.target.value)}
                fullWidth
              >
                {ENTITY_TYPES.map((value) => (
                  <MenuItem key={value || "all"} value={value}>{value || "All entities"}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Claim ID"
                value={filters.claimId}
                onChange={(e) => updateFilter("claimId", e.target.value.trim())}
                fullWidth
              />
            </Stack>
          </CardContent>
        </Card>

        {error && <Alert severity="error">{error}</Alert>}

        <Card>
          <CardContent sx={{ p: 0 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>User</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Entity</TableCell>
                    <TableCell>Claim</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Safe details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!loading && data.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">No audit events match these filters.</TableCell>
                    </TableRow>
                  )}
                  {data.items.map((item) => (
                    <TableRow key={item.id} hover>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {item.actor?.email || "System"}
                        {item.actor?.role ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {item.actor.role}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{actionLabel(item.action)}</TableCell>
                      <TableCell>
                        {item.entityType}
                        {item.entityId ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {item.entityId}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.claimId || "—"}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={item.outcome}
                          color={item.outcome === "SUCCESS" ? "success" : item.outcome === "DENIED" ? "warning" : "error"}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {Object.keys(item.metadata || {}).length
                          ? Object.entries(item.metadata).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" • ")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
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
