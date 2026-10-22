import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  AccountBalanceWallet,
  ArrowBack,
  CheckCircle,
  Visibility
} from "@mui/icons-material";
import { useNavigate, useParams } from "react-router-dom";
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

const FLOW = [
  ["OPEN", "Review Variance"],
  ["REVIEWING", "Validate Recovery"],
  ["DISPUTE_PREPARED", "Prepare Dispute"],
  ["DISPUTE_SUBMITTED", "Track Recovery"],
  ["RECOVERED", "Recovered"]
];

function statusColor(status) {
  if (status === "RECOVERED") return "success";
  if (status === "WRITTEN_OFF") return "error";
  if (status === "DISPUTE_SUBMITTED") return "info";
  if (["REVIEWING", "DISPUTE_PREPARED"].includes(status)) return "warning";
  return "default";
}

function workflowIndex(status) {
  if (status === "WRITTEN_OFF" || status === "CLOSED") return 4;
  const index = FLOW.findIndex(([value]) => value === status);
  return index < 0 ? 0 : index;
}

export default function UnderpaymentWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showDialog, confirmDialog } = useToast();
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
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
      setLoading(false);
    }
  }, [id, showDialog]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function saveCase() {
    if (!detail) return;

    const currentRecovered = Number(detail.recoveredAmount || 0);
    const nextRecovered =
      edit.recoveredAmount === "" ? currentRecovered : Number(edit.recoveredAmount);
    const materialChange =
      edit.status !== detail.status ||
      (Number.isFinite(nextRecovered) && nextRecovered !== currentRecovered);

    if (materialChange) {
      const confirmed = await confirmDialog(
        "Are you sure you want to change this recovery status or recovered amount? This affects payment-recovery reporting and case history.",
        {
          title: "Confirm recovery update",
          severity: "warning",
          confirmLabel: "Confirm Update",
          cancelLabel: "Cancel"
        }
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const updated = await UnderpaymentsApi.update(detail.id, {
        status: edit.status,
        recoveredAmount:
          edit.recoveredAmount === "" ? undefined : Number(edit.recoveredAmount),
        reasonCategory: edit.reasonCategory,
        notes: edit.notes
      });
      setDetail((current) => ({ ...current, ...updated }));
      setEdit({
        status: updated.status || "OPEN",
        recoveredAmount: updated.recoveredAmount ?? "",
        reasonCategory: updated.reasonCategory || "",
        notes: updated.notes || ""
      });
      localStorage.setItem("revenueRecoveryUpdatedAt", String(Date.now()));
    } catch (error) {
      showDialog(error.message || "Unable to update the recovery case.", {
        title: "Recovery update failed",
        severity: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  function closeWorkspace() {
    if (window.opener) {
      window.close();
      return;
    }
    navigate("/revenue-recovery");
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: "45vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!detail) {
    return (
      <Alert severity="error">
        The underpayment recovery case could not be loaded.
      </Alert>
    );
  }

  const currentStep = workflowIndex(detail.status);
  const resolved = ["RECOVERED", "WRITTEN_OFF", "CLOSED"].includes(detail.status);

  return (
    <Box sx={{ py: 1.5, maxWidth: 1450, mx: "auto" }} data-testid="underpayment-workspace">
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 1.25 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>Underpayment Recovery Workspace</Typography>
          <Typography variant="body2" color="text.secondary">
            {detail.claim?.patientName || "—"} · {detail.claim?.payerName || "—"} · {detail.claim?.insurerClaimNo || detail.claimId}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75}>
          <Chip
            size="small"
            label={String(detail.status || "").replaceAll("_", " ")}
            color={statusColor(detail.status)}
            variant="outlined"
          />
          <Button variant="outlined" size="small" startIcon={<ArrowBack />} onClick={closeWorkspace}>
            Back to Recovery
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ px: 1.25, py: 1, mb: 1.25 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(5, minmax(0,1fr))" }, gap: 0.5 }}>
          {FLOW.map(([status, label], index) => {
            const complete = index < currentStep || (detail.status === "RECOVERED" && index === currentStep);
            const active = index === currentStep && !complete;
            return (
              <Box
                key={status}
                data-testid={`underpayment-step-${index + 1}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1,
                  py: 0.7,
                  borderRadius: 1,
                  bgcolor: active ? "rgba(23,59,87,0.08)" : "transparent",
                  border: "1px solid",
                  borderColor: active ? "primary.light" : "transparent"
                }}
              >
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    bgcolor: complete ? "success.main" : active ? "primary.main" : "grey.200",
                    color: complete || active ? "#fff" : "text.secondary"
                  }}
                >
                  {complete ? "✓" : index + 1}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={active || complete ? 750 : 600} noWrap>
                    {label}
                  </Typography>
                  <Typography variant="caption" color={complete ? "success.main" : active ? "primary.main" : "text.secondary"}>
                    {complete ? "Complete" : active ? "In progress" : "Pending"}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Paper>

      {resolved && (
        <Alert severity={detail.status === "RECOVERED" ? "success" : "info"} sx={{ mb: 1.25 }}>
          This recovery case is {String(detail.status).replaceAll("_", " ").toLowerCase()}. Its recorded financial outcome remains available below.
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 2.2fr) minmax(290px, 0.8fr)" }, gap: 1.25 }}>
        <Stack spacing={1.25}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
              <Box>
                <Typography variant="subtitle1" fontWeight={800}>Payment Variance</Typography>
                <Typography variant="body2" color="text.secondary">
                  Compare expected payer payment with the posted payer payment before progressing the recovery case.
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
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
            </Stack>

            <Box sx={{ mt: 1.25, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" }, gap: 1 }}>
              {[
                ["Expected payer payment", detail.expectedPayerPayment],
                ["Actual payer payment", detail.actualPaidAmount],
                ["Detected variance", detail.varianceAmount]
              ].map(([label, value], index) => (
                <Box key={label} sx={{ p: 1.1, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="h6" fontWeight={850} color={index === 2 ? "error.main" : "text.primary"}>
                    {formatUSD(value)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={800}>Recovery Case</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              Update the recovery status, recorded recovery amount, reason, and operational notes.
            </Typography>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
              <FormControl size="small" disabled={resolved}>
                <InputLabel>Recovery Status</InputLabel>
                <Select
                  label="Recovery Status"
                  value={edit.status}
                  onChange={(event) => setEdit((current) => ({ ...current, status: event.target.value }))}
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
                disabled={resolved}
                onChange={(event) => setEdit((current) => ({ ...current, recoveredAmount: event.target.value }))}
              />

              <TextField
                size="small"
                label="Reason Category"
                value={edit.reasonCategory}
                disabled={resolved}
                onChange={(event) => setEdit((current) => ({ ...current, reasonCategory: event.target.value }))}
              />

              <TextField
                multiline
                minRows={4}
                label="Recovery Notes"
                value={edit.notes}
                disabled={resolved}
                onChange={(event) => setEdit((current) => ({ ...current, notes: event.target.value }))}
                sx={{ gridColumn: { md: "1 / -1" } }}
              />
            </Box>

            {!resolved && (
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                <Button variant="contained" onClick={saveCase} disabled={saving}>
                  {saving ? "Saving..." : "Save Recovery Case"}
                </Button>
              </Stack>
            )}
          </Paper>
        </Stack>

        <Stack spacing={1.25}>
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Claim Summary</Typography>
            <Stack spacing={0.65} sx={{ mt: 1 }}>
              {[
                ["Patient", detail.claim?.patientName || "—"],
                ["Payer", detail.claim?.payerName || "—"],
                ["Claim #", detail.claim?.insurerClaimNo || detail.claimId || "—"],
                ["Member ID", detail.claim?.memberId || "—"],
                ["Payment reference", detail.claim?.paymentReference || "—"]
              ].map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" fontWeight={650} textAlign="right">{value}</Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Recovery Summary</Typography>
            <Box sx={{ mt: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Recovered</Typography>
                <Typography variant="h6" fontWeight={850} color="success.main">
                  {formatUSD(detail.recoveredAmount)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Outstanding</Typography>
                <Typography variant="h6" fontWeight={850}>
                  {formatUSD(detail.outstandingAmount)}
                </Typography>
              </Box>
            </Box>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={0.75} alignItems="center">
              {detail.status === "RECOVERED" && <CheckCircle color="success" fontSize="small" />}
              <Typography variant="body2" fontWeight={700}>
                {String(detail.status).replaceAll("_", " ")}
              </Typography>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" fontWeight={800}>Next Action</Typography>
            <Typography variant="body2" sx={{ mt: 0.75 }}>
              {detail.status === "OPEN"
                ? "Review the payment variance and move the case into recovery review."
                : detail.status === "REVIEWING"
                ? "Validate the recovery basis and prepare the payer dispute."
                : detail.status === "DISPUTE_PREPARED"
                ? "Submit the dispute through the approved payer channel and record the next workflow status."
                : detail.status === "DISPUTE_SUBMITTED"
                ? "Track payer response and record recovered dollars when received."
                : detail.status === "RECOVERED"
                ? "Recovery is complete."
                : "Review the final case outcome and claim history."}
            </Typography>
          </Paper>

          <Button
            variant="outlined"
            startIcon={<Visibility />}
            onClick={() => navigate(`/claims/${detail.claimId}`)}
          >
            Open Claim Detail
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
