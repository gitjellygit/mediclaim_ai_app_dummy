import React from "react";
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
import { useNavigate } from "react-router-dom";
import { RevenueRecoveryApi } from "../../api/revenueRecovery.js";
import { formatUSD } from "../../utils/currency.js";

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

function summaryCard(label, value, caption, tone = "text.primary") {
  return (
    <Card>
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
  const navigate = useNavigate();
  const [data, setData] = React.useState({
    items: [],
    metrics: null,
    topPayers: [],
    topRootCauses: [],
    methodology: null
  });
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("ALL");
  const [status, setStatus] = React.useState("ACTIVE");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
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
        limit: 100
      });
      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        metrics: result?.metrics || null,
        topPayers: Array.isArray(result?.topPayers) ? result.topPayers : [],
        topRootCauses: Array.isArray(result?.topRootCauses)
          ? result.topRootCauses
          : [],
        methodology: result?.methodology || null
      });
    } catch (loadError) {
      setError(
        loadError?.message || "Revenue Recovery could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [query, type, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const metrics = data.metrics || {
    activeOpportunities: 0,
    totalOutstanding: 0,
    totalRecovered: 0,
    deadlinesDue7: 0,
    criticalCount: 0
  };

  function openRecovery(item) {
    if (item.type === "DENIAL") {
      navigate(`/denials?caseId=${item.id}`);
      return;
    }
    navigate(`/payments?caseId=${item.id}`);
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
          gap: 2,
          mb: 3
        }}
      >
        {summaryCard(
          "Active Opportunities",
          metrics.activeOpportunities,
          "Denials + underpayments"
        )}
        {summaryCard(
          "Outstanding Recovery",
          money(metrics.totalOutstanding),
          "Open recoverable dollars"
        )}
        {summaryCard(
          "Recovered",
          money(metrics.totalRecovered),
          "Recorded recovery to date",
          "success.main"
        )}
        {summaryCard(
          "Deadlines ≤ 7 Days",
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
          gap: 2,
          mb: 3
        }}
      >
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <TrendingUp fontSize="small" color="primary" />
            <Typography fontWeight={800}>Top Payer Leakage</Typography>
          </Stack>
          {data.topPayers.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No outstanding recovery opportunities.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {data.topPayers.map((payer) => (
                <Stack
                  key={payer.label}
                  direction="row"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {payer.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {payer.count} open opportunit{payer.count === 1 ? "y" : "ies"}
                    </Typography>
                  </Box>
                  <Typography fontWeight={800}>
                    {money(payer.outstandingAmount)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <WarningAmber fontSize="small" color="warning" />
            <Typography fontWeight={800}>Top Recovery Root Causes</Typography>
          </Stack>
          {data.topRootCauses.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No recurring root causes yet.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {data.topRootCauses.map((cause) => (
                <Stack
                  key={cause.label}
                  direction="row"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700}>
                      {cause.label.replaceAll("_", " ")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {cause.count} case{cause.count === 1 ? "" : "s"}
                    </Typography>
                  </Box>
                  <Typography fontWeight={800}>
                    {money(cause.outstandingAmount)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>

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
              label="Recovery Type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <MenuItem value="ALL">All recovery</MenuItem>
              <MenuItem value="DENIAL">Denials</MenuItem>
              <MenuItem value="UNDERPAYMENT">Underpayments</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Workflow</InputLabel>
            <Select
              label="Workflow"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
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
        <TableContainer component={Paper}>
          <Table size="small" sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow>
                <TableCell><b>Priority</b></TableCell>
                <TableCell><b>Patient / Payer</b></TableCell>
                <TableCell><b>Recovery Type</b></TableCell>
                <TableCell><b>Root Cause</b></TableCell>
                <TableCell><b>Outstanding</b></TableCell>
                <TableCell><b>Deadline</b></TableCell>
                <TableCell><b>Workflow</b></TableCell>
                <TableCell><b>Next Action</b></TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.type + ":" + item.id} hover>
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
                      {String(item.rootCause || "Unclassified").replaceAll("_", " ")}
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
                    {item.recoveredAmount > 0 && (
                      <Typography variant="caption" color="success.main">
                        {money(item.recoveredAmount)} recovered
                      </Typography>
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
                      label={String(item.status).replaceAll("_", " ")}
                    />
                  </TableCell>

                  <TableCell sx={{ minWidth: 220 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {item.nextAction}
                    </Typography>
                  </TableCell>

                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      endIcon={<ArrowForward />}
                      onClick={() => openRecovery(item)}
                    >
                      Work Case
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

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
