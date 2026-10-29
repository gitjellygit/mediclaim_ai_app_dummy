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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { PatientPaymentsApi } from "../../api/patientPayments.js";
import { formatUSD } from "../../utils/currency.js";
import { AuthApi } from "../../api/auth.js";
import { hasPermission, PERMISSIONS } from "../../security/permissions.js";
import { useToast } from "../../context/ToastContext.jsx";

const statusColor = {
  UNPAID: "error",
  PARTIALLY_PAID: "warning",
  PAID: "success"
};

export default function PatientPayments() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast, showDialog } = useToast();
  const user = AuthApi.getUser();
  const canEdit = hasPermission(user, PERMISSIONS.FINANCIAL_EDIT);

  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [loading, setLoading] = React.useState(false);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [paymentBusy, setPaymentBusy] = React.useState(false);
  const [payment, setPayment] = React.useState({
    amount: "",
    method: "CARD",
    reference: "",
    notes: ""
  });

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await PatientPaymentsApi.list({ q, status });
      setItems(data.items || []);
    } catch (error) {
      showDialog(error?.message || "Unable to load patient balances.", {
        title: "Patient payments",
        severity: "error"
      });
    } finally {
      setLoading(false);
    }
  }, [q, status, showDialog]);

  const loadDetail = React.useCallback(async (balanceId) => {
    if (!balanceId) {
      setSelected(null);
      return;
    }
    try {
      const data = await PatientPaymentsApi.get(balanceId);
      setSelected(data);
    } catch (error) {
      showDialog(error?.message || "Unable to load patient balance.", {
        title: "Patient payments",
        severity: "error"
      });
    }
  }, [showDialog]);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  React.useEffect(() => {
    void loadDetail(id);
  }, [id, loadDetail]);

  function openBalance(item) {
    navigate(`/patient-payments/${item.id}`);
  }

  function startPayment() {
    setPayment({
      amount: selected?.balanceAmount ? String(selected.balanceAmount) : "",
      method: "CARD",
      reference: "",
      notes: ""
    });
    setPaymentOpen(true);
  }

  async function recordPayment() {
    const amount = Number(payment.amount);
    if (!selected || !Number.isFinite(amount) || amount <= 0) return;
    setPaymentBusy(true);
    try {
      const result = await PatientPaymentsApi.recordPayment(selected.id, {
        amount,
        method: payment.method,
        reference: payment.reference.trim() || null,
        notes: payment.notes.trim() || null
      });
      setSelected(result.balance);
      setPaymentOpen(false);
      await loadList();
      showToast("Patient payment recorded", "success");
    } catch (error) {
      showDialog(error?.message || "Payment could not be recorded.", {
        title: "Payment failed",
        severity: "error"
      });
    } finally {
      setPaymentBusy(false);
    }
  }

  async function markStatementSent() {
    if (!selected) return;
    try {
      const next = await PatientPaymentsApi.update(selected.id, { statementStatus: "SENT" });
      setSelected(next);
      await loadList();
      showToast("Statement marked as sent", "success");
    } catch (error) {
      showToast(error?.message || "Unable to update statement status", "error");
    }
  }

  async function startPaymentPlan() {
    if (!selected) return;
    try {
      const next = await PatientPaymentsApi.update(selected.id, { paymentPlanStatus: "ACTIVE" });
      setSelected(next);
      await loadList();
      showToast("Payment plan activated", "success");
    } catch (error) {
      showToast(error?.message || "Unable to activate payment plan", "error");
    }
  }

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Patient Payments</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage self-pay and patient-responsibility balances without forcing them through the insurance claim workflow.
          </Typography>
        </Box>
        {id && (
          <Button variant="outlined" onClick={() => navigate("/patient-payments")}>Back to balances</Button>
        )}
      </Stack>

      {!id ? (
        <>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1.5 }}>
            <TextField
              size="small"
              label="Search patient, MRN, or encounter"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              sx={{ minWidth: { sm: 320 } }}
            />
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="ALL">All balances</MenuItem>
              <MenuItem value="UNPAID">Unpaid</MenuItem>
              <MenuItem value="PARTIALLY_PAID">Partially paid</MenuItem>
              <MenuItem value="PAID">Paid</MenuItem>
            </TextField>
            <Button variant="outlined" onClick={loadList} disabled={loading}>Refresh</Button>
          </Stack>

          <Stack spacing={1}>
            {items.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                onClick={() => openBalance(item)}
                sx={{ p: 1.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr auto", md: "1.5fr 1fr 1fr 1fr auto" },
                    gap: 1.5,
                    alignItems: "center"
                  }}
                >
                  <Box>
                    <Typography fontWeight={800}>{item.patientName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.externalEncounterId ? `Encounter ${item.externalEncounterId}` : "Manual balance"}
                      {item.serviceDate ? ` • ${new Date(item.serviceDate).toLocaleDateString()}` : ""}
                    </Typography>
                  </Box>
                  <Box sx={{ display: { xs: "none", md: "block" } }}>
                    <Typography variant="caption" color="text.secondary">Patient responsibility</Typography>
                    <Typography fontWeight={700}>{formatUSD(item.patientResponsibility || 0)}</Typography>
                  </Box>
                  <Box sx={{ display: { xs: "none", md: "block" } }}>
                    <Typography variant="caption" color="text.secondary">Paid</Typography>
                    <Typography fontWeight={700}>{formatUSD(item.paidAmount || 0)}</Typography>
                  </Box>
                  <Box sx={{ display: { xs: "none", md: "block" } }}>
                    <Typography variant="caption" color="text.secondary">Balance</Typography>
                    <Typography fontWeight={800}>{formatUSD(item.balanceAmount || 0)}</Typography>
                  </Box>
                  <Chip size="small" color={statusColor[item.status] || "default"} label={item.status.replaceAll("_", " ")} />
                </Box>
              </Paper>
            ))}
            {!loading && items.length === 0 && (
              <Alert severity="info">No patient balances match the current filters.</Alert>
            )}
          </Stack>
        </>
      ) : selected ? (
        <Stack spacing={2}>
          <Card variant="outlined">
            <CardContent>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Patient responsibility</Typography>
                  <Typography variant="h5" fontWeight={800}>{selected.patientName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selected.externalEncounterId ? `Encounter ${selected.externalEncounterId}` : "Patient balance"}
                    {selected.medicalRecordNumber ? ` • MRN ${selected.medicalRecordNumber}` : ""}
                  </Typography>
                </Box>
                <Chip color={statusColor[selected.status] || "default"} label={selected.status.replaceAll("_", " ")} />
              </Stack>

              <Box
                sx={{
                  mt: 2,
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
                  gap: 1.5
                }}
              >
                <Box><Typography variant="caption" color="text.secondary">Charges</Typography><Typography variant="h6">{formatUSD(selected.totalCharges || 0)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Insurance</Typography><Typography variant="h6">{formatUSD(selected.insuranceResponsibility || 0)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Paid</Typography><Typography variant="h6">{formatUSD(selected.paidAmount || 0)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Balance due</Typography><Typography variant="h6" fontWeight={800}>{formatUSD(selected.balanceAmount || 0)}</Typography></Box>
              </Box>

              <Divider sx={{ my: 2 }} />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="contained" disabled={!canEdit || selected.balanceAmount <= 0} onClick={startPayment}>Record Payment</Button>
                <Button variant="outlined" disabled={!canEdit || selected.statementStatus === "SENT"} onClick={markStatementSent}>
                  {selected.statementStatus === "SENT" ? "Statement Sent" : "Mark Statement Sent"}
                </Button>
                <Button variant="outlined" disabled={!canEdit || selected.paymentPlanStatus === "ACTIVE" || selected.balanceAmount <= 0} onClick={startPaymentPlan}>
                  {selected.paymentPlanStatus === "ACTIVE" ? "Payment Plan Active" : "Start Payment Plan"}
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>Payment history</Typography>
              <Stack spacing={1}>
                {(selected.payments || []).map((item) => (
                  <Paper key={item.id} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography fontWeight={700}>{item.method.replaceAll("_", " ")}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(item.paidAt).toLocaleString()}
                          {item.reference ? ` • Ref ${item.reference}` : ""}
                        </Typography>
                      </Box>
                      <Typography fontWeight={800}>{formatUSD(item.amount)}</Typography>
                    </Stack>
                  </Paper>
                ))}
                {(selected.payments || []).length === 0 && (
                  <Typography color="text.secondary">No payments recorded yet.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      ) : (
        <Typography color="text.secondary">Loading patient balance…</Typography>
      )}

      <Dialog open={paymentOpen} onClose={() => !paymentBusy && setPaymentOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Record Patient Payment</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Alert severity="info">
              Remaining balance: {formatUSD(selected?.balanceAmount || 0)}
            </Alert>
            <TextField
              label="Amount"
              type="number"
              value={payment.amount}
              onChange={(e) => setPayment((prev) => ({ ...prev, amount: e.target.value }))}
              inputProps={{ min: 0.01, step: 0.01 }}
            />
            <TextField select label="Payment method" value={payment.method} onChange={(e) => setPayment((prev) => ({ ...prev, method: e.target.value }))}>
              {["CARD", "CASH", "CHECK", "HSA_FSA", "ACH", "OTHER"].map((method) => (
                <MenuItem key={method} value={method}>{method.replaceAll("_", " ")}</MenuItem>
              ))}
            </TextField>
            <TextField label="Reference (optional)" value={payment.reference} onChange={(e) => setPayment((prev) => ({ ...prev, reference: e.target.value }))} />
            <TextField label="Notes (optional)" multiline minRows={2} value={payment.notes} onChange={(e) => setPayment((prev) => ({ ...prev, notes: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentOpen(false)} disabled={paymentBusy}>Cancel</Button>
          <Button variant="contained" onClick={recordPayment} disabled={paymentBusy || Number(payment.amount) <= 0}>
            {paymentBusy ? "Recording…" : "Record Payment"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
