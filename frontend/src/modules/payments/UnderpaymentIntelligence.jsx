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
  TableSortLabel,
  TextField,
  Typography
} from "@mui/material";
import {
  Refresh,
  Search as SearchIcon,
  Visibility
} from "@mui/icons-material";
import { UnderpaymentsApi } from "../../api/underpayments.js";
import { useToast } from "../../context/ToastContext.jsx";
import { formatUSD } from "../../utils/currency.js";

const STATUSES = [
  "OPEN",
  "REVIEWING",
  "DISPUTE_PREPARED",
  "DISPUTE_SUBMITTED",
  "RECOVERED",
  "WRITTEN_OFF",
  "CLOSED"
];

function statusColor(status) {
  if (status === "RECOVERED") return "success";
  if (status === "WRITTEN_OFF") return "error";
  if (status === "DISPUTE_SUBMITTED") return "info";
  if (["REVIEWING", "DISPUTE_PREPARED"].includes(status)) return "warning";
  return "default";
}

export default function UnderpaymentIntelligence() {
  const { showDialog } = useToast();
  const [rows, setRows] = React.useState([]);
  const [metrics, setMetrics] = React.useState({
    activeCases: 0,
    totalCases: 0,
    totalVariance: 0,
    recoveredAmount: 0,
    outstandingAmount: 0,
    recoveryRate: 0
  });
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [sort, setSort] = React.useState("outstanding");
  const [direction, setDirection] = React.useState("desc");
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await UnderpaymentsApi.list({
        query: search.trim(),
        status
      });
      setRows(result?.items || []);
      setMetrics(result?.metrics || {});
    } catch (error) {
      showDialog(error.message || "Unable to load payment variance cases.", {
        title: "Underpayment Recovery",
        severity: "error"
      });
    } finally {
      setLoading(false);
    }
  }, [search, status, showDialog]);

  React.useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const sortedRows = React.useMemo(() => {
    const copy = [...rows];
    const value = (row) => {
      switch (sort) {
        case "patient": return String(row.claim?.patientName || "").toLowerCase();
        case "expected": return Number(row.expectedPayerPayment || 0);
        case "paid": return Number(row.actualPaidAmount || 0);
        case "variance": return Number(row.varianceAmount || 0);
        case "recovered": return Number(row.recoveredAmount || 0);
        case "outstanding": return Number(row.outstandingAmount || 0);
        case "status": return String(row.status || "");
        default: return 0;
      }
    };
    copy.sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const result =
        typeof left === "string"
          ? left.localeCompare(String(right))
          : Number(left) - Number(right);
      return direction === "desc" ? -result : result;
    });
    return copy;
  }, [rows, sort, direction]);

  function handleSort(field) {
    if (sort === field) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(field);
    setDirection(
      ["expected", "paid", "variance", "recovered", "outstanding"].includes(field)
        ? "desc"
        : "asc"
    );
  }

  function sortableHeader(label, field, defaultDirection = "asc") {
    return (
      <TableSortLabel
        hideSortIcon={false}
        sx={{
          "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" },
          "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" }
        }}
        active={sort === field}
        direction={sort === field ? direction : defaultDirection}
        onClick={() => handleSort(field)}
      >
        <b>{label}</b>
      </TableSortLabel>
    );
  }

  function openCase(id) {
    window.open(
      `/revenue-recovery/underpayments/${id}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <Box sx={{ py: 1.5 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>Underpayment Recovery</Typography>
          <Typography variant="body2" color="text.secondary">
            Detect payer underpayments and track recovery from review through resolution.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<Refresh />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        Underpayment is calculated from expected payer payment versus actual payer payment. Patient responsibility and normal contractual adjustments are excluded.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(5, 1fr)" },
          gap: 1,
          mb: 1.5
        }}
      >
        {[
          ["Active Cases", metrics.activeCases ?? 0],
          ["Variance Detected", formatUSD(metrics.totalVariance ?? 0)],
          ["Outstanding", formatUSD(metrics.outstandingAmount ?? 0)],
          ["Recovered", formatUSD(metrics.recoveredAmount ?? 0)],
          ["Recovery Rate", `${metrics.recoveryRate ?? 0}%`]
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="h5" fontWeight={800}>{value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Paper sx={{ p: 1.25, mb: 1.25 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search patient, payer, member ID or payer claim number..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              )
            }}
          />
          <FormControl size="small" sx={{ minWidth: 210 }}>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <MenuItem value="ALL">All statuses</MenuItem>
              {STATUSES.map((item) => (
                <MenuItem key={item} value={item}>{item.replaceAll("_", " ")}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 5, textAlign: "center" }}>
          <CircularProgress />
        </Paper>
      ) : rows.length === 0 ? (
        <Alert severity="success">No payment variance cases match the current filter.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" sx={{ minWidth: 1050 }}>
            <TableHead>
              <TableRow>
                <TableCell>{sortableHeader("Patient / Payer", "patient")}</TableCell>
                <TableCell>{sortableHeader("Expected Payer", "expected", "desc")}</TableCell>
                <TableCell>{sortableHeader("Paid", "paid", "desc")}</TableCell>
                <TableCell>{sortableHeader("Variance", "variance", "desc")}</TableCell>
                <TableCell>{sortableHeader("Recovered", "recovered", "desc")}</TableCell>
                <TableCell>{sortableHeader("Outstanding", "outstanding", "desc")}</TableCell>
                <TableCell>{sortableHeader("Status", "status")}</TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography fontWeight={700}>{row.claim?.patientName || "—"}</Typography>
                    <Typography variant="body2" color="text.secondary">{row.claim?.payerName || "—"}</Typography>
                    {row.claim?.insurerClaimNo && (
                      <Typography variant="caption" color="text.secondary">
                        Claim {row.claim.insurerClaimNo}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{formatUSD(row.expectedPayerPayment)}</TableCell>
                  <TableCell>{formatUSD(row.actualPaidAmount)}</TableCell>
                  <TableCell>
                    <Typography fontWeight={700} color="error.main">{formatUSD(row.varianceAmount)}</Typography>
                  </TableCell>
                  <TableCell>{formatUSD(row.recoveredAmount)}</TableCell>
                  <TableCell><Typography fontWeight={700}>{formatUSD(row.outstandingAmount)}</Typography></TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status.replaceAll("_", " ")} color={statusColor(row.status)} />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<Visibility />} onClick={() => openCase(row.id)}>
                      Open Workspace
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
