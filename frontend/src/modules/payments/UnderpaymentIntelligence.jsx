import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
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
  Typography
} from "@mui/material";
import {
  AccountBalanceWallet,
  Refresh,
  Search as SearchIcon,
  Visibility
} from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, showDialog } = useToast();
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
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [edit, setEdit] = React.useState({
    status: "OPEN",
    recoveredAmount: "",
    reasonCategory: "",
    notes: ""
  });

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
        title: "Payment Variance Intelligence",
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

  async function openCase(id) {
    setDetailLoading(true);
    try {
      const item = await UnderpaymentsApi.get(id);
      setDetail(item);
      setEdit({
        status: item.status || "OPEN",
        recoveredAmount: item.recoveredAmount ?? "",
        reasonCategory: item.reasonCategory || "",
        notes: item.notes || ""
      });
    } catch (error) {
      showDialog(error.message || "Unable to open the recovery case.", {
        title: "Recovery case",
        severity: "error"
      });
    } finally {
      setDetailLoading(false);
    }
  }

  React.useEffect(() => {
    const caseId = new URLSearchParams(location.search).get("caseId");
    if (caseId && caseId !== detail?.id) {
      openCase(caseId);
    }
  }, [location.search]);

  async function saveCase() {
    if (!detail) return;
    setSaving(true);
    try {
      const updated = await UnderpaymentsApi.update(detail.id, {
        status: edit.status,
        recoveredAmount:
          edit.recoveredAmount === "" ? undefined : Number(edit.recoveredAmount),
        reasonCategory: edit.reasonCategory,
        notes: edit.notes
      });
      setDetail(updated);
      showToast("Recovery case updated", "success");
      await load();
    } catch (error) {
      showDialog(error.message || "Unable to update the recovery case.", {
        title: "Recovery update failed",
        severity: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Payment Variance Intelligence
          </Typography>
          <Typography color="text.secondary">
            Detect payer underpayments and track recovery from review through resolution.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Refresh />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        Underpayment is calculated from expected payer payment versus actual payer payment.
        Patient responsibility and normal contractual adjustments are excluded.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(5, 1fr)" },
          gap: 2,
          mb: 3
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
              <Typography variant="h5" fontWeight={700}>{value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search patient, payer, member ID or payer claim number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              )
            }}
          />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <MenuItem value="ALL">All statuses</MenuItem>
              {STATUSES.map((item) => (
                <MenuItem key={item} value={item}>{item.replaceAll("_", " ")}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress />
        </Paper>
      ) : rows.length === 0 ? (
        <Alert severity="success">
          No payment variance cases match the current filter.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><b>Patient / Payer</b></TableCell>
                <TableCell><b>Expected Payer</b></TableCell>
                <TableCell><b>Paid</b></TableCell>
                <TableCell><b>Variance</b></TableCell>
                <TableCell><b>Recovered</b></TableCell>
                <TableCell><b>Outstanding</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{row.claim?.patientName || "—"}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {row.claim?.payerName || "—"}
                    </Typography>
                    {row.claim?.insurerClaimNo && (
                      <Typography variant="caption" color="text.secondary">
                        Claim {row.claim.insurerClaimNo}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{formatUSD(row.expectedPayerPayment)}</TableCell>
                  <TableCell>{formatUSD(row.actualPaidAmount)}</TableCell>
                  <TableCell>
                    <Typography fontWeight={700} color="error.main">
                      {formatUSD(row.varianceAmount)}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatUSD(row.recoveredAmount)}</TableCell>
                  <TableCell>
                    <Typography fontWeight={700}>{formatUSD(row.outstandingAmount)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.status.replaceAll("_", " ")}
                      color={statusColor(row.status)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<Visibility />}
                      onClick={() => openCase(row.id)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Drawer
        anchor="right"
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 560 }, p: 3 } }}
      >
        {detailLoading || !detail ? (
          <Box sx={{ p: 5, textAlign: "center" }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h5" fontWeight={700}>Recovery Case</Typography>
              <Typography color="text.secondary">
                {detail.claim?.patientName} • {detail.claim?.payerName}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                icon={<AccountBalanceWallet />}
                label={`Variance ${formatUSD(detail.varianceAmount)}`}
                color="error"
                variant="outlined"
              />
              <Chip
                label={`Outstanding ${formatUSD(detail.outstandingAmount)}`}
                color="warning"
              />
            </Stack>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography color="text.secondary">Expected payer payment</Typography>
                  <Typography fontWeight={600}>{formatUSD(detail.expectedPayerPayment)}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography color="text.secondary">Actual payer payment</Typography>
                  <Typography fontWeight={600}>{formatUSD(detail.actualPaidAmount)}</Typography>
                </Stack>
                <Divider />
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={700}>Detected variance</Typography>
                  <Typography fontWeight={700}>{formatUSD(detail.varianceAmount)}</Typography>
                </Stack>
              </Stack>
            </Paper>

            <FormControl size="small">
              <InputLabel>Recovery Status</InputLabel>
              <Select
                label="Recovery Status"
                value={edit.status}
                onChange={(e) => setEdit((current) => ({ ...current, status: e.target.value }))}
              >
                {STATUSES.map((item) => (
                  <MenuItem key={item} value={item}>{item.replaceAll("_", " ")}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size="small"
              type="number"
              label="Recovered Amount"
              inputProps={{ min: 0, step: "0.01" }}
              value={edit.recoveredAmount}
              onChange={(e) => setEdit((current) => ({ ...current, recoveredAmount: e.target.value }))}
            />

            <TextField
              size="small"
              label="Reason Category"
              value={edit.reasonCategory}
              onChange={(e) => setEdit((current) => ({ ...current, reasonCategory: e.target.value }))}
            />

            <TextField
              multiline
              minRows={4}
              label="Recovery Notes"
              value={edit.notes}
              onChange={(e) => setEdit((current) => ({ ...current, notes: e.target.value }))}
            />

            <Button variant="contained" onClick={saveCase} disabled={saving}>
              {saving ? "Saving..." : "Save Recovery Case"}
            </Button>

            <Button
              startIcon={<Visibility />}
              onClick={() => navigate(`/claims/${detail.claimId}`)}
            >
              Open Claim Detail
            </Button>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
