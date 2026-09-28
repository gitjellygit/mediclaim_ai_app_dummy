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
  CheckCircle,
  Lock,
  Refresh,
  Visibility
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { useToast } from "../../context/ToastContext.jsx";

const STAGE_LABELS = {
  eligibility: "1. Eligibility",
  priorAuth: "2. Prior Authorization",
  claim: "3. Claim",
  claimStatus: "4. Claim Status",
  remittance: "5. Remittance"
};

function money(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(n);
}

function date(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US");
}

function stageColor(status) {
  if (
    ["VERIFIED", "APPROVED", "NOT_REQUIRED", "READY", "SUBMITTED", "PAID", "RECEIVED", "POSTED", "ACKNOWLEDGED"].includes(status)
  ) return "success";
  if (["FAILED", "DENIED"].includes(status)) return "error";
  if (["NEEDS_REVIEW", "REQUIRED", "IN_REVIEW", "PARTIALLY_APPROVED"].includes(status)) return "warning";
  return "default";
}

function StageCard({ title, status, actionable, blockedReason, children }) {
  return (
    <Card sx={{ height: "100%", opacity: actionable ? 1 : 0.72 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="h6" fontWeight={700}>{title}</Typography>
          <Chip
            size="small"
            color={stageColor(status)}
            variant={status === "NOT_CHECKED" || status === "NOT_AVAILABLE" ? "outlined" : "filled"}
            label={status || "NOT_AVAILABLE"}
          />
        </Stack>

        {!actionable && (
          <Alert severity="info" icon={<Lock fontSize="inherit" />} sx={{ mt: 2 }}>
            {blockedReason}
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

export default function ClaimJourney() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [claims, setClaims] = React.useState([]);
  const [claimId, setClaimId] = React.useState("");
  const [journey, setJourney] = React.useState(null);
  const [loadingClaims, setLoadingClaims] = React.useState(true);
  const [loadingJourney, setLoadingJourney] = React.useState(false);
  const [pageError, setPageError] = React.useState("");
  const [action, setAction] = React.useState("");

  const [authRequired, setAuthRequired] = React.useState("");
  const [authorizationNo, setAuthorizationNo] = React.useState("");
  const [authExpiry, setAuthExpiry] = React.useState("");
  const [payerStatus, setPayerStatus] = React.useState("ACKNOWLEDGED");
  const [remittanceStatus, setRemittanceStatus] = React.useState("AWAITING");
  const [allowedAmount, setAllowedAmount] = React.useState("");
  const [patientResponsibility, setPatientResponsibility] = React.useState("");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [paymentReference, setPaymentReference] = React.useState("");

  const loadClaims = React.useCallback(async () => {
    setLoadingClaims(true);
    setPageError("");
    try {
      const data = await ClaimsApi.list();
      const list = Array.isArray(data) ? data : [];
      setClaims(list);
      if (!claimId && list.length > 0) setClaimId(list[0].id);
    } catch (error) {
      setPageError(error.message || "Unable to load claims");
    } finally {
      setLoadingClaims(false);
    }
  }, [claimId]);

  const loadJourney = React.useCallback(async (id) => {
    if (!id) return;
    setLoadingJourney(true);
    setPageError("");
    try {
      const data = await ClaimsApi.getJourney(id);
      setJourney(data);

      const claim = data.claim || {};
      setAuthRequired(
        claim.priorAuthRequired == null
          ? ""
          : claim.priorAuthRequired
          ? "YES"
          : "NO"
      );
      setAuthorizationNo(claim.authorizationNo || "");
      setAuthExpiry(
        claim.priorAuthExpiry
          ? new Date(claim.priorAuthExpiry).toISOString().slice(0, 10)
          : ""
      );
      setPayerStatus(claim.payerClaimStatus || "ACKNOWLEDGED");
      setRemittanceStatus(
        claim.remittanceStatus && claim.remittanceStatus !== "NOT_AVAILABLE"
          ? claim.remittanceStatus
          : "AWAITING"
      );
      setAllowedAmount(claim.allowedAmount ?? "");
      setPatientResponsibility(claim.patientResponsibility ?? "");
      setPaidAmount(claim.paidAmount ?? "");
      setPaymentReference(claim.paymentReference || "");
    } catch (error) {
      setJourney(null);
      setPageError(error.message || "Unable to load claim journey");
    } finally {
      setLoadingJourney(false);
    }
  }, []);

  React.useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  React.useEffect(() => {
    if (claimId) loadJourney(claimId);
  }, [claimId, loadJourney]);

  async function runAction(name, fn, successMessage) {
    setAction(name);
    setPageError("");
    try {
      await fn();
      await loadJourney(claimId);
      showToast(successMessage, "success");
    } catch (error) {
      const message = error.message || "Action failed";
      setPageError(message);
      showToast(message, "error");
    } finally {
      setAction("");
    }
  }

  const claim = journey?.claim;
  const stages = journey?.stages;

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
            Claim Journey
          </Typography>
          <Typography color="text.secondary">
            Eligibility → Prior Auth → Claim → Status → Remittance
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => {
            loadClaims();
            if (claimId) loadJourney(claimId);
          }}
          disabled={loadingClaims || loadingJourney}
        >
          Refresh
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <FormControl fullWidth size="small" disabled={loadingClaims}>
          <InputLabel>Select Claim</InputLabel>
          <Select
            label="Select Claim"
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
          >
            {claims.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.patientName || "Unknown Patient"} — {item.payerName || "No payer"} — {item.policyNo || "No policy"}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Paper>

      {pageError && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => claimId && loadJourney(claimId)}>
              Retry
            </Button>
          }
        >
          {pageError}
        </Alert>
      )}

      {loadingJourney && (
        <Paper sx={{ p: 5, textAlign: "center" }}>
          <CircularProgress size={32} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading claim journey...
          </Typography>
        </Paper>
      )}

      {!loadingJourney && claim && stages && (
        <>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={2}
              >
                <Box>
                  <Typography variant="h5" fontWeight={700}>{claim.patientName}</Typography>
                  <Typography color="text.secondary">
                    {claim.payerName} • Policy {claim.policyNo || "—"} • Member {claim.memberId || "—"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Chip label={claim.status} color={stageColor(claim.status)} />
                  <Button
                    size="small"
                    startIcon={<Visibility />}
                    onClick={() => navigate(`/claims/${claim.id}`)}
                  >
                    Claim Detail
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {!journey.livePayerConnectorConfigured && (
            <Alert severity="info" sx={{ mb: 3 }}>
              Eligibility and prior-authorization actions currently perform local workflow pre-checks / recorded decisions.
              No live payer or clearinghouse connector is configured yet.
            </Alert>
          )}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(5, minmax(0, 1fr))" },
              gap: 2,
              alignItems: "stretch"
            }}
          >
            <StageCard
              title={STAGE_LABELS.eligibility}
              status={stages.eligibility.status}
              actionable={stages.eligibility.actionable}
            >
              <Stack spacing={1.2}>
                <Typography variant="body2"><b>Coverage:</b> {stages.eligibility.coverageStatus || "—"}</Typography>
                <Typography variant="body2"><b>Network:</b> {stages.eligibility.networkStatus || "—"}</Typography>
                <Typography variant="body2"><b>Deductible Remaining:</b> {money(stages.eligibility.deductibleRemaining)}</Typography>
                <Typography variant="body2"><b>Coinsurance:</b> {stages.eligibility.coinsurancePct == null ? "—" : `${stages.eligibility.coinsurancePct}%`}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Last checked: {date(stages.eligibility.checkedAt)}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  disabled={action === "eligibility"}
                  onClick={() =>
                    runAction(
                      "eligibility",
                      () => ClaimsApi.runEligibilityPrecheck(claim.id),
                      "Eligibility pre-check completed"
                    )
                  }
                >
                  {action === "eligibility" ? "Checking..." : "Run Pre-check"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.priorAuth}
              status={stages.priorAuth.status}
              actionable={stages.priorAuth.actionable}
              blockedReason={stages.priorAuth.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.priorAuth.actionable}>
                  <InputLabel>Auth Required?</InputLabel>
                  <Select
                    label="Auth Required?"
                    value={authRequired}
                    onChange={(e) => setAuthRequired(e.target.value)}
                  >
                    <MenuItem value="">Unknown</MenuItem>
                    <MenuItem value="YES">Yes</MenuItem>
                    <MenuItem value="NO">No</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Authorization No."
                  value={authorizationNo}
                  onChange={(e) => setAuthorizationNo(e.target.value)}
                  disabled={!stages.priorAuth.actionable || authRequired !== "YES"}
                />
                <TextField
                  size="small"
                  label="Expiry"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={authExpiry}
                  onChange={(e) => setAuthExpiry(e.target.value)}
                  disabled={!stages.priorAuth.actionable || authRequired !== "YES"}
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={!stages.priorAuth.actionable || action === "auth" || authRequired === ""}
                  onClick={() =>
                    runAction(
                      "auth",
                      () =>
                        ClaimsApi.evaluatePriorAuth(claim.id, {
                          required: authRequired === "YES",
                          authorizationNo,
                          expiry: authExpiry || null
                        }),
                      "Prior authorization stage updated"
                    )
                  }
                >
                  {action === "auth" ? "Saving..." : "Evaluate"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.claim}
              status={stages.claim.status}
              actionable={stages.claim.actionable}
              blockedReason={stages.claim.blockedReason}
            >
              <Stack spacing={1.2}>
                <Typography variant="body2"><b>Claimed:</b> {money(claim.amount)}</Typography>
                <Typography variant="body2"><b>Billed:</b> {money(claim.totalBilledAmount)}</Typography>
                <Typography variant="body2"><b>Documents:</b> {claim.documents?.length || 0}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Submitted: {date(stages.claim.submissionDate)}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={!stages.claim.actionable}
                  onClick={() => navigate(`/claims/${claim.id}`)}
                >
                  Open Claim
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.claimStatus}
              status={stages.claimStatus.status}
              actionable={stages.claimStatus.actionable}
              blockedReason={stages.claimStatus.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.claimStatus.actionable}>
                  <InputLabel>Payer Status</InputLabel>
                  <Select
                    label="Payer Status"
                    value={payerStatus}
                    onChange={(e) => setPayerStatus(e.target.value)}
                  >
                    <MenuItem value="ACKNOWLEDGED">Acknowledged</MenuItem>
                    <MenuItem value="IN_REVIEW">In Review</MenuItem>
                    <MenuItem value="APPROVED">Approved</MenuItem>
                    <MenuItem value="PARTIALLY_APPROVED">Partially Approved</MenuItem>
                    <MenuItem value="DENIED">Denied</MenuItem>
                    <MenuItem value="PAID">Paid</MenuItem>
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary">
                  Last updated: {date(stages.claimStatus.checkedAt)}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  disabled={!stages.claimStatus.actionable || action === "status"}
                  onClick={() =>
                    runAction(
                      "status",
                      () => ClaimsApi.updatePayerStatus(claim.id, payerStatus),
                      "Payer claim status recorded"
                    )
                  }
                >
                  {action === "status" ? "Saving..." : "Record Status"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.remittance}
              status={stages.remittance.status}
              actionable={stages.remittance.actionable}
              blockedReason={stages.remittance.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.remittance.actionable}>
                  <InputLabel>Remittance</InputLabel>
                  <Select
                    label="Remittance"
                    value={remittanceStatus}
                    onChange={(e) => setRemittanceStatus(e.target.value)}
                  >
                    <MenuItem value="AWAITING">Awaiting</MenuItem>
                    <MenuItem value="RECEIVED">Received</MenuItem>
                    <MenuItem value="POSTED">Posted</MenuItem>
                  </Select>
                </FormControl>
                <TextField size="small" type="number" label="Allowed Amount" value={allowedAmount} onChange={(e) => setAllowedAmount(e.target.value)} disabled={!stages.remittance.actionable} />
                <TextField size="small" type="number" label="Patient Responsibility" value={patientResponsibility} onChange={(e) => setPatientResponsibility(e.target.value)} disabled={!stages.remittance.actionable} />
                <TextField size="small" type="number" label="Paid Amount" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} disabled={!stages.remittance.actionable} />
                <TextField size="small" label="Payment Reference" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} disabled={!stages.remittance.actionable} />
                <Button
                  variant="contained"
                  size="small"
                  disabled={!stages.remittance.actionable || action === "remittance"}
                  onClick={() =>
                    runAction(
                      "remittance",
                      () =>
                        ClaimsApi.updateRemittance(claim.id, {
                          remittanceStatus,
                          allowedAmount,
                          patientResponsibility,
                          paidAmount,
                          paymentReference
                        }),
                      "Remittance information recorded"
                    )
                  }
                >
                  {action === "remittance" ? "Saving..." : "Record Remittance"}
                </Button>
              </Stack>
            </StageCard>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Alert severity="success" icon={<CheckCircle />}>
            Workflow guidance is gated, but every stage remains visible. Downstream stages are read-only until their prerequisites are complete.
          </Alert>
        </>
      )}

      {!loadingJourney && !claim && !pageError && claims.length === 0 && (
        <Alert severity="info">No claims are available yet.</Alert>
      )}
    </Box>
  );
}
