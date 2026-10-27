import React from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  ArrowForward,
  Refresh,
  Search as SearchIcon,
  TrendingUp,
  WarningAmber
} from "@mui/icons-material";
import { RevenueRecoveryApi } from "../../api/revenueRecovery.js";
import { AuthApi } from "../../api/auth.js";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import ClaimAssignmentDialog from "../../components/ClaimAssignmentDialog.jsx";
import { formatUSD } from "../../utils/currency.js";
import { humanizeEnum } from "../../utils/displayLabels.js";

const money = formatUSD;

function priorityColor(priority) {
  if (priority === "CRITICAL") return "error";
  if (priority === "HIGH") return "warning";
  if (priority === "MEDIUM") return "info";
  return "default";
}

function typeColor(type) {
  return type === "DENIAL" ? "error" : "warning";
}

function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US");
}

function deadlineLabel(item) {
  if (item.type !== "DENIAL") return "Not applicable";
  if (item.deadlineDays == null) return "No deadline recorded";
  if (item.deadlineDays < 0) {
    return `Expired ${Math.abs(item.deadlineDays)}d ago`;
  }
  if (item.deadlineDays === 0) return "Due today";
  return `${item.deadlineDays}d remaining`;
}

function summaryCard(label, value, caption, tone = "text.primary", highlight = false) {
  return (
    <Card
      sx={
        highlight
          ? {
              border: "1px solid",
              borderColor: "success.light",
              backgroundColor: "rgba(46, 125, 50, 0.06)",
              boxShadow: 2
            }
          : undefined
      }
    >
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" fontWeight={800} color={tone}>
          {value}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function RevenueRecovery() {
  const [searchParams] = useSearchParams();
  const focusedClaimId = searchParams.get("claimId") || "";
  const user = AuthApi.getUser();
  const canManageAssignments =
    hasPermission(user, PERMISSIONS.RECOVERY_EDIT) ||
    hasPermission(user, PERMISSIONS.CLAIM_EDIT);
  const [assignmentTarget, setAssignmentTarget] = React.useState(null);
  const [data, setData] = React.useState({
    items: [],
    metrics: null,
    topPayers: [],
    topRootCauses: [],
    methodology: null,
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1
  });
  const [search, setSearch] = React.useState(focusedClaimId);
  const [query, setQuery] = React.useState(focusedClaimId);
  const [type, setType] = React.useState("ALL");
  const [status, setStatus] = React.useState("ACTIVE");
  const [page, setPage] = React.useState(0);
  const [sort, setSort] = React.useState("priority");
  const [direction, setDirection] = React.useState("desc");
  const pageSize = 10;
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setQuery(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await RevenueRecoveryApi.list({
        query,
        type,
        status,
        page: page + 1,
        pageSize,
        sort,
        direction
      });
      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        metrics: result?.metrics || null,
        topPayers: Array.isArray(result?.topPayers) ? result.topPayers : [],
        topRootCauses: Array.isArray(result?.topRootCauses)
          ? result.topRootCauses
          : [],
        methodology: result?.methodology || null,
        total: Number(result?.total || 0),
        page: Number(result?.page || page + 1),
        pageSize: Number(result?.pageSize || pageSize),
        totalPages: Number(result?.totalPages || 1)
      });
    } catch (loadError) {
      setError(
        loadError?.message || "Revenue Recovery could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [query, type, status, page, sort, direction]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    const refresh = () => load();
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    const refreshOnStorage = (event) => {
      if (event.key === "revenueRecoveryUpdatedAt") load();
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refreshOnStorage);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refreshOnStorage);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [load]);

  const metrics = data.metrics || {
    activeOpportunities: 0,
    totalOutstanding: 0,
    totalRecovered: 0,
    deadlinesDue7: 0,
    criticalCount: 0
  };

  const maxPayerLeakage = Math.max(
    1,
    ...data.topPayers.map((item) => Number(item.outstandingAmount || 0))
  );
  const maxRootCauseLeakage = Math.max(
    1,
    ...data.topRootCauses.map((item) => Number(item.outstandingAmount || 0))
  );
  const financialMixTotal =
    Number(metrics.totalOutstanding || 0) + Number(metrics.totalRecovered || 0);
  const recoveredPct =
    financialMixTotal > 0
      ? (Number(metrics.totalRecovered || 0) / financialMixTotal) * 100
      : 0;

  function handleSort(column) {
    setPage(0);
    if (sort === column) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(column);
    setDirection(column === "patient" || column === "payer" || column === "deadline" ? "asc" : "desc");
  }

  function sortableHeader(label, column, align = "left") {
    return (
      <TableCell align={align}>
        <TableSortLabel
          hideSortIcon={false}
          sx={{
            "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" },
            "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" }
          }}
          active={sort === column}
          direction={sort === column ? direction : "asc"}
          onClick={() => handleSort(column)}
        >
          <b>{label}</b>
        </TableSortLabel>
      </TableCell>
    );
  }

  function openRecovery(item) {
    if (item.type === "DENIAL") {
      window.open(
        `/revenue-recovery/appeals/${item.id}`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }
    window.open(
      `/revenue-recovery/underpayments/${item.id}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Revenue Recovery
          </Typography>
          <Typography color="text.secondary">
            Prioritize denials and underpayments by recoverable dollars, deadline urgency,
            payer patterns and the next best operational action.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={load}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        Recovery Priority is a transparent operational score, not a probability of
        payment or appeal success. Payer responses, remittance data, contracts,
        denial codes and supporting claim records remain the source of truth.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            lg: "repeat(5, 1fr)"
          },
          gap: 1.5,
          mb: 2
        }}
      >
        {summaryCard(
          "Active Opportunities",
          metrics.activeOpportunities,
          "Denials + Underpayments"
        )}
        {summaryCard(
          "Outstanding Recovery",
          money(metrics.totalOutstanding),
          "Open recoverable amount"
        )}
        {summaryCard(
          "Recovered",
          money(metrics.totalRecovered),
          "Across all cases matching the current filters",
          "success.main",
          true
        )}
        {summaryCard(
          "Appeals Due ≤ 7 Days",
          metrics.deadlinesDue7,
          "Appeal deadlines",
          metrics.deadlinesDue7 > 0 ? "warning.main" : "text.primary"
        )}
        {summaryCard(
          "Critical Priority",
          metrics.criticalCount,
          "Work first",
          metrics.criticalCount > 0 ? "error.main" : "text.primary"
        )}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 1.5,
          mb: 2
        }}
      >
        <Paper sx={{ p: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <TrendingUp fontSize="small" color="primary" />
            <Typography fontWeight={800}>Top Payer Leakage</Typography>
          </Stack>
          {data.topPayers.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No outstanding recovery opportunities.
            </Typography>
          ) : (
            <Stack spacing={0.9}>
              {data.topPayers.map((payer) => (
                <Box key={payer.label}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>{payer.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {payer.count} open opportunit{payer.count === 1 ? "y" : "ies"}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={800}>{money(payer.outstandingAmount)}</Typography>
                  </Stack>
                  <Box sx={{ height: 7, bgcolor: "action.hover", borderRadius: 999, overflow: "hidden", mt: 0.35 }}>
                    <Box sx={{
                      height: "100%",
                      width: `${Math.max(4, (Number(payer.outstandingAmount || 0) / maxPayerLeakage) * 100)}%`,
                      bgcolor: "primary.main",
                      borderRadius: 999
                    }} />
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>

        <Paper sx={{ p: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <WarningAmber fontSize="small" color="warning" />
            <Typography fontWeight={800}>Top Recovery Root Causes</Typography>
          </Stack>
          {data.topRootCauses.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No recurring root causes yet.
            </Typography>
          ) : (
            <Stack spacing={0.9}>
              {data.topRootCauses.map((cause) => (
                <Box key={cause.label}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700}>
                        {humanizeEnum(cause.label, "Unclassified")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {cause.count} case{cause.count === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={800}>{money(cause.outstandingAmount)}</Typography>
                  </Stack>
                  <Box sx={{ height: 7, bgcolor: "action.hover", borderRadius: 999, overflow: "hidden", mt: 0.35 }}>
                    <Box sx={{
                      height: "100%",
                      width: `${Math.max(4, (Number(cause.outstandingAmount || 0) / maxRootCauseLeakage) * 100)}%`,
                      bgcolor: "warning.main",
                      borderRadius: 999
                    }} />
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ px: 1.5, py: 1.1, mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} spacing={1.25}>
          <Box sx={{ minWidth: 160 }}>
            <Typography variant="caption" color="text.secondary">Recovery Financial Mix</Typography>
            <Typography variant="body2" fontWeight={800}>
              {money(metrics.totalRecovered)} recovered · {money(metrics.totalOutstanding)} outstanding
            </Typography>
          </Box>
          <Box sx={{ flex: 1, height: 12, bgcolor: "error.light", borderRadius: 999, overflow: "hidden", display: "flex" }}>
            <Box sx={{ width: `${recoveredPct}%`, bgcolor: "success.main" }} />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {financialMixTotal > 0 ? `${recoveredPct.toFixed(0)}% recovered` : "No recovery dollars yet"}
          </Typography>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", md: "center" }}
        >
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search patient, payer or payer claim number..."
            sx={{ flex: 1, minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
          />

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Recovery Type</InputLabel>
            <Select
              data-testid="recovery-type-filter"
              label="Recovery Type"
              value={type}
              onChange={(event) => {
                setPage(0);
                setType(event.target.value);
              }}
            >
              <MenuItem value="ALL">All recovery</MenuItem>
              <MenuItem value="DENIAL">Denials</MenuItem>
              <MenuItem value="UNDERPAYMENT">Underpayments</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Workflow</InputLabel>
            <Select
              data-testid="recovery-workflow-filter"
              label="Workflow"
              value={status}
              onChange={(event) => {
                setPage(0);
                setStatus(event.target.value);
              }}
            >
              <MenuItem value="ACTIVE">Active work</MenuItem>
              <MenuItem value="ALL">All cases</MenuItem>
              <MenuItem value="OPEN">Open</MenuItem>
              <MenuItem value="ANALYZED">Analyzed</MenuItem>
              <MenuItem value="REVIEWING">Reviewing</MenuItem>
              <MenuItem value="APPEAL_PREPARED">Appeal prepared</MenuItem>
              <MenuItem value="APPEAL_SUBMITTED">Appeal submitted</MenuItem>
              <MenuItem value="DISPUTE_PREPARED">Dispute prepared</MenuItem>
              <MenuItem value="DISPUTE_SUBMITTED">Dispute submitted</MenuItem>
              <MenuItem value="RECOVERED">Recovered</MenuItem>
              <MenuItem value="CLOSED">Closed</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress size={34} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading revenue recovery...
          </Typography>
        </Paper>
      ) : data.items.length === 0 ? (
        <Alert severity="info">
          No recovery opportunities match the current filters.
        </Alert>
      ) : (
        <Paper>
          <TableContainer>
          <Table size="small" sx={{ minWidth: 1160 }}>
            <TableHead>
              <TableRow>
                {sortableHeader("Priority", "priority")}
                {sortableHeader("Patient / Payer", "patient")}
                <TableCell><b>Recovery Type</b></TableCell>
                <TableCell><b>Root Cause</b></TableCell>
                {sortableHeader("Outstanding", "outstanding")}
                {sortableHeader("Recovered", "recovered")}
                {sortableHeader("Deadline", "deadline")}
                <TableCell><b>Workflow</b></TableCell>
                <TableCell><b>Recovery Owner</b></TableCell>
                <TableCell><b>Next Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((item) => (
                <TableRow
                  key={item.type + ":" + item.id}
                  hover
                  data-testid={
                    focusedClaimId && item.claimId === focusedClaimId
                      ? "focused-recovery-row"
                      : undefined
                  }
                  sx={
                    focusedClaimId && item.claimId === focusedClaimId
                      ? {
                          backgroundColor: "rgba(237,108,2,0.08)",
                          outline: "2px solid",
                          outlineColor: "warning.main",
                          outlineOffset: -2
                        }
                      : undefined
                  }
                >
                  <TableCell>
                    <Stack spacing={0.4} alignItems="flex-start">
                      <Tooltip title={data.methodology?.priority || ""}>
                        <Chip
                          size="small"
                          color={priorityColor(item.priority)}
                          label={item.priority}
                        />
                      </Tooltip>
                      <Typography variant="caption" color="text.secondary">
                        {item.priorityScore}/100
                      </Typography>
                    </Stack>
                  </TableCell>

                  <TableCell sx={{ minWidth: 210 }}>
                    <Typography fontWeight={700}>
                      {item.patientName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {item.payerName}
                    </Typography>
                    {item.insurerClaimNo && (
                      <Typography variant="caption" color="text.secondary">
                        Claim {item.insurerClaimNo}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={typeColor(item.type)}
                      label={item.type === "DENIAL" ? "Denial" : "Underpayment"}
                    />
                  </TableCell>

                  <TableCell sx={{ minWidth: 180 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {humanizeEnum(item.rootCause, "Unclassified")}
                    </Typography>
                    {item.codeSummary && (
                      <Typography variant="caption" color="text.secondary">
                        {item.codeSummary}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Typography fontWeight={800}>
                      {money(item.outstandingAmount)}
                    </Typography>
                  </TableCell>

                  <TableCell sx={{ minWidth: 135 }}>
                    {item.recoveredAmount > 0 ? (
                      <Stack spacing={0.2}>
                        <Typography
                          variant="subtitle1"
                          color="success.main"
                          fontWeight={900}
                          sx={{ lineHeight: 1.1 }}
                        >
                          {money(item.recoveredAmount)}
                        </Typography>
                        <Typography variant="caption" color="success.dark" fontWeight={700}>
                          Recovered
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>

                  <TableCell sx={{ minWidth: 145 }}>
                    <Typography
                      variant="body2"
                      color={
                        item.deadlineDays != null && item.deadlineDays <= 7
                          ? item.deadlineDays < 0
                            ? "error.main"
                            : "warning.dark"
                          : "text.primary"
                      }
                      fontWeight={
                        item.deadlineDays != null && item.deadlineDays <= 7
                          ? 700
                          : 400
                      }
                    >
                      {deadlineLabel(item)}
                    </Typography>
                    {item.deadline && (
                      <Typography variant="caption" color="text.secondary">
                        {date(item.deadline)}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={humanizeEnum(item.status)}
                    />
                  </TableCell>

                  <TableCell sx={{ minWidth: 180 }}>
                    <Typography variant="body2" fontWeight={700}>
                      {item.assignedToUser?.displayName || item.assignedToUser?.email || "Unassigned"}
                    </Typography>
                    {item.workTeam && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {item.workTeam}
                      </Typography>
                    )}
                    {canManageAssignments && (
                      <Button
                        size="small"
                        sx={{ px: 0, mt: 0.25 }}
                        onClick={() =>
                          setAssignmentTarget({
                            claimIds: [item.claimId],
                            currentAssigneeId: item.assignedToUser?.id || "",
                            currentTeam: item.workTeam || "",
                            title: `Assign recovery work · ${item.patientName}`
                          })
                        }
                      >
                        {item.assignedToUser ? "Reassign" : "Assign"}
                      </Button>
                    )}
                  </TableCell>

                  <TableCell sx={{ minWidth: 240 }}>
                    <Button
                      size="small"
                      variant="text"
                      endIcon={<ArrowForward />}
                      onClick={() => openRecovery(item)}
                      data-testid="recovery-next-action"
                      aria-label={`${item.nextAction} for ${item.patientName}`}
                      sx={{
                        justifyContent: "flex-start",
                        px: 0.5,
                        textAlign: "left",
                        fontWeight: 700,
                        textTransform: "none"
                      }}
                    >
                      {item.nextAction}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={data.total}
            page={Math.min(page, Math.max(0, Math.ceil(data.total / pageSize) - 1))}
            onPageChange={(_event, nextPage) => setPage(nextPage)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10]}
            labelRowsPerPage="Rows per page"
          />
        </Paper>
      )}

      <ClaimAssignmentDialog
        open={Boolean(assignmentTarget)}
        claimIds={assignmentTarget?.claimIds || []}
        currentAssigneeId={assignmentTarget?.currentAssigneeId || ""}
        currentTeam={assignmentTarget?.currentTeam || ""}
        title={assignmentTarget?.title || "Assign recovery work"}
        loadUsers={RevenueRecoveryApi.assignmentUsers}
        saveAssignment={({ claimIds, assignedToUserId, workTeam }) =>
          RevenueRecoveryApi.assignClaim(claimIds[0], { assignedToUserId, workTeam })
        }
        onClose={() => setAssignmentTarget(null)}
        onSaved={load}
      />

      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mt: 2 }}
      >
        This workspace intentionally shows only the minimum claim identity and financial
        context needed to perform recovery work. Detailed clinical/document data stays in
        the underlying claim and is accessed through its existing permission-controlled workflow.
      </Typography>
    </Box>
  );
}
