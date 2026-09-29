import React from "react";
import {
  Alert,
  Autocomplete,
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
  Tooltip,
  Typography
} from "@mui/material";
import {
  CheckCircle,
  Lock,
  Refresh,
  Search,
  Visibility
} from "@mui/icons-material";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { useToast } from "../../context/ToastContext.jsx";

const STAGE_LABELS = {
  eligibility: "1. Eligibility",
  priorAuth: "2. Prior Authorization",
  claim: "3. Claim Submission",
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

function humanStatus(status) {
  return String(status || "NOT_AVAILABLE")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StageCard({
  title,
  status,
  actionable,
  blockedReason,
  onStatusClick,
  statusHelp,
  stageId,
  highlighted = false,
  children
}) {
  return (
    <Card
      id={stageId}
      sx={{
        height: "100%",
        opacity: actionable ? 1 : 0.72,
        scrollMarginTop: 96,
        border: highlighted ? "2px solid" : undefined,
        borderColor: highlighted ? "warning.main" : undefined,
        boxShadow: highlighted ? 4 : undefined
      }}
    >
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={1}
          sx={{ flexWrap: "wrap", rowGap: 1 }}
        >
          <Typography variant="h6" fontWeight={700}>{title}</Typography>
          <Tooltip
            title={
              onStatusClick
                ? statusHelp || "Review and fix this stage"
                : humanStatus(status)
            }
          >
            <Chip
              size="small"
              color={stageColor(status)}
              variant={
                status === "NOT_CHECKED" || status === "NOT_AVAILABLE"
                  ? "outlined"
                  : "filled"
              }
              label={humanStatus(status)}
              onClick={onStatusClick}
              clickable={Boolean(onStatusClick)}
              sx={
                onStatusClick
                  ? {
                      cursor: "pointer",
                      "&:hover": { boxShadow: 2 }
                    }
                  : undefined
              }
            />
          </Tooltip>
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const [claims, setClaims] = React.useState([]);
  const [selectedClaim, setSelectedClaim] = React.useState(null);
  const [claimId, setClaimId] = React.useState("");
  const [searchText, setSearchText] = React.useState("");
  const [journey, setJourney] = React.useState(null);
  const [loadingClaims, setLoadingClaims] = React.useState(true);
  const searchRequestRef = React.useRef(0);
  const searchInitializedRef = React.useRef(false);
  const routeInitializedRef = React.useRef(false);
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
  const [patientResponsibilityManual, setPatientResponsibilityManual] = React.useState(false);
  const [paidAmount, setPaidAmount] = React.useState("");
  const [paymentReference, setPaymentReference] = React.useState("");

  /**
   * Search claims on the server so this selector stays fast with tens of
   * thousands of records. Empty search shows recent claims; typed search is
   * debounced and capped at 20 results.
   */
  const loadClaims = React.useCallback(async (query = "", selectFirst = false) => {
    const requestId = ++searchRequestRef.current;
    setLoadingClaims(true);

    try {
      const data = await ClaimsApi.searchClaims(query, query ? 20 : 10);

      // Ignore a slower response from an older search request.
      if (requestId !== searchRequestRef.current) return;

      const list = Array.isArray(data?.items) ? data.items : [];
      setClaims(list);

      if (selectFirst && list.length > 0) {
        setSelectedClaim((current) => current || list[0]);
        setClaimId((current) => current || list[0].id);
      }
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      setPageError(error.message || "Unable to search claims");
    } finally {
      if (requestId === searchRequestRef.current) {
        setLoadingClaims(false);
      }
    }
  }, []);

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
      setPaidAmount(claim.paidAmount ?? "");

      const currentAllowed = Number(claim.allowedAmount);
      const currentPaid = Number(claim.paidAmount);
      const derivedPatientResponsibility =
        Number.isFinite(currentAllowed) && Number.isFinite(currentPaid)
          ? Math.max(0, currentAllowed - currentPaid)
          : null;
      const recordedPatientResponsibility =
        claim.patientResponsibility == null
          ? null
          : Number(claim.patientResponsibility);

      setPatientResponsibility(
        recordedPatientResponsibility ??
          derivedPatientResponsibility ??
          ""
      );
      setPatientResponsibilityManual(
        recordedPatientResponsibility != null &&
          derivedPatientResponsibility != null &&
          recordedPatientResponsibility !== derivedPatientResponsibility
      );
      setPaymentReference(claim.paymentReference || "");
    } catch (error) {
      setJourney(null);
      setPageError(error.message || "Unable to load claim journey");
    } finally {
      setLoadingJourney(false);
    }
  }, []);

  React.useEffect(() => {
    if (routeInitializedRef.current) return;
    routeInitializedRef.current = true;

    const initialClaimId = searchParams.get("claimId");

    loadClaims("", !initialClaimId);

    if (initialClaimId) {
      ClaimsApi.get(initialClaimId)
        .then((claim) => {
          setSelectedClaim(claim);
          setClaimId(claim.id);
        })
        .catch((error) => {
          setPageError(error.message || "Unable to restore selected claim");
        });
    }
  }, [loadClaims, searchParams]);

  React.useEffect(() => {
    // Initial recent claims are loaded by the mount effect above. Skip the
    // first search effect to avoid an unnecessary duplicate request.
    if (!searchInitializedRef.current) {
      searchInitializedRef.current = true;
      return;
    }

    const query = searchText.trim();

    // One-character searches are intentionally held back to avoid broad,
    // expensive database queries and noisy results.
    if (query.length === 1) return;

    const timer = setTimeout(() => {
      loadClaims(query.length >= 2 ? query : "");
    }, 350);

    return () => clearTimeout(timer);
  }, [searchText, loadClaims]);

  React.useEffect(() => {
    if (claimId) loadJourney(claimId);
  }, [claimId, loadJourney]);

  async function runAction(name, fn, successMessage) {
    setAction(name);
    setPageError("");
    try {
      const result = await fn();
      await loadJourney(claimId);

      // Idempotent backend responses deliberately produce no duplicate
      // "updated" toast when nothing changed.
      if (!result?.unchanged) {
        showToast(successMessage, "success");
      }

      return result;
    } catch (error) {
      const message = error.message || "Action failed";
      setPageError(message);
      showToast(message, "error");
      return null;
    } finally {
      setAction("");
    }
  }

  const claim = journey?.claim;
  const stages = journey?.stages;
  const focusedStage = searchParams.get("stage") || "";

  const eligibilityComplete = stages?.eligibility?.status === "VERIFIED";

  const authFormMatchesSaved = Boolean(claim) &&
    (claim.priorAuthRequired == null
      ? authRequired === ""
      : (claim.priorAuthRequired ? "YES" : "NO") === authRequired) &&
    (claim.authorizationNo || "") === authorizationNo &&
    (claim.priorAuthExpiry
      ? new Date(claim.priorAuthExpiry).toISOString().slice(0, 10)
      : "") === authExpiry;

  const payerStatusUnchanged = Boolean(claim) &&
    (claim.payerClaimStatus || "ACKNOWLEDGED") === payerStatus;

  function asNullableNumber(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const remittanceDirty = Boolean(claim) && (
    (claim.remittanceStatus || "AWAITING") !== remittanceStatus ||
    (claim.allowedAmount ?? null) !== asNullableNumber(allowedAmount) ||
    (claim.patientResponsibility ?? null) !== asNullableNumber(patientResponsibility) ||
    (claim.paidAmount ?? null) !== asNullableNumber(paidAmount) ||
    (claim.paymentReference || "") !== paymentReference.trim()
  );

  React.useEffect(() => {
    if (patientResponsibilityManual) return;

    const allowed = asNullableNumber(allowedAmount);
    const paid = asNullableNumber(paidAmount);

    if (allowed == null || paid == null) {
      setPatientResponsibility("");
      return;
    }

    setPatientResponsibility(String(Math.max(0, allowed - paid)));
  }, [allowedAmount, paidAmount, patientResponsibilityManual]);

  React.useEffect(() => {
    if (!claim || !focusedStage) return;

    const stageElement = document.getElementById(`journey-stage-${focusedStage}`);
    if (!stageElement) return;

    window.setTimeout(() => {
      stageElement.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 120);
  }, [claim?.id, focusedStage]);

  function claimReturnState() {
    const from = `/journey?claimId=${claim?.id || ""}`;
    return {
      from,
      backLabel: "Back to Claim Journey"
    };
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2, lg: 3 } }}>
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
            const query = searchText.trim();
            loadClaims(query.length >= 2 ? query : "");
            if (claimId) loadJourney(claimId);
          }}
          disabled={loadingClaims || loadingJourney}
        >
          Refresh
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Autocomplete
          fullWidth
          options={claims}
          value={selectedClaim}
          loading={loadingClaims}
          filterOptions={(options) => options}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          getOptionLabel={(option) =>
            [
              option.patientName || "Unknown Patient",
              option.memberId ? `Member ${option.memberId}` : null,
              option.payerName || null,
              option.policyNo ? `Policy ${option.policyNo}` : null
            ]
              .filter(Boolean)
              .join(" — ")
          }
          onInputChange={(_event, value, reason) => {
            if (reason === "input" || reason === "clear") {
              setSearchText(value);
            }
          }}
          onChange={(_event, value) => {
            setSelectedClaim(value);
            setClaimId(value?.id || "");

            if (value?.id) {
              setSearchParams({ claimId: value.id }, { replace: true });
            } else {
              setSearchParams({}, { replace: true });
              setJourney(null);
            }
          }}
          noOptionsText={
            searchText.trim().length === 1
              ? "Type one more character to search"
              : "No matching claims found"
          }
          renderOption={(props, option) => (
            <Box component="li" {...props} key={option.id}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {option.patientName || "Unknown Patient"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[
                    option.memberId ? `Member ${option.memberId}` : null,
                    option.policyNo ? `Policy ${option.policyNo}` : null,
                    option.payerName || null,
                    option.status || null
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </Typography>
              </Box>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Find Claim"
              placeholder="Search patient, member ID, policy, payer, claim or authorization no."
              helperText={
                searchText.trim()
                  ? "Showing the best matching claims"
                  : "Recent claims are shown until you start typing"
              }
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <Search fontSize="small" sx={{ ml: 1, mr: 0.5, color: "text.secondary" }} />
                    {params.InputProps.startAdornment}
                  </>
                ),
                endAdornment: (
                  <>
                    {loadingClaims ? <CircularProgress size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                )
              }}
            />
          )}
        />
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
                    onClick={() =>
                      navigate(`/claims/${claim.id}`, {
                        state: claimReturnState()
                      })
                    }
                  >
                    Claim Detail
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {claim.automationSummary && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "stretch", md: "center" }}
                  spacing={2}
                >
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      Automation Snapshot
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {claim.automationSummary.automatedFields} fields auto-populated •{" "}
                      {claim.automationSummary.reviewFields} need review •{" "}
                      {claim.automationSummary.manualFields} manual •{" "}
                      {claim.automationSummary.missingFields} missing
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color="success"
                      label={`${claim.automationSummary.automationRate}% automated`}
                    />
                    {claim.automationSummary.reviewFields > 0 && (
                      <Chip
                        size="small"
                        color="warning"
                        label={`${claim.automationSummary.reviewFields} review`}
                      />
                    )}
                    {claim.automationSummary.missingFields > 0 && (
                      <Chip
                        size="small"
                        color="error"
                        label={`${claim.automationSummary.missingFields} missing`}
                      />
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          )}

          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
            sx={{ mb: 2, px: 0.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              <b>*</b> Required
            </Typography>
            <Typography variant="caption" color="warning.main">
              Conditional fields highlight when required
            </Typography>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(3, minmax(0, 1fr))",
                xl: "repeat(4, minmax(0, 1fr))"
              },
              "@media (min-width:1900px)": {
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))"
              },
              gap: { xs: 1.5, md: 2 },
              alignItems: "stretch"
            }}
          >
            <StageCard
              title={STAGE_LABELS.eligibility}
              stageId="journey-stage-eligibility"
              highlighted={focusedStage === "eligibility"}
              status={stages.eligibility.status}
              actionable={stages.eligibility.actionable}
              onStatusClick={
                ["NEEDS_REVIEW", "FAILED"].includes(stages.eligibility.status)
                  ? () =>
                      navigate(`/claims/${claim.id}`, {
                        state: {
                          ...claimReturnState(),
                          focus: "eligibility"
                        }
                      })
                  : undefined
              }
              statusHelp={
                stages.eligibility.status === "NEEDS_REVIEW"
                  ? "Review missing member, policy, payer, or coverage information"
                  : "Open claim details to review eligibility information"
              }
            >
              <Stack spacing={1.2}>
                <Typography variant="body2">
                  <b>Coverage:</b>{" "}
                  {stages.eligibility.coverageStatus === "UNKNOWN"
                    ? "Not payer-verified"
                    : stages.eligibility.coverageStatus || "—"}
                </Typography>
                <Typography variant="body2"><b>Network:</b> {stages.eligibility.networkStatus || "—"}</Typography>
                <Typography variant="body2"><b>Deductible Remaining:</b> {money(stages.eligibility.deductibleRemaining)}</Typography>
                <Typography variant="body2"><b>Coinsurance:</b> {stages.eligibility.coinsurancePct == null ? "—" : `${stages.eligibility.coinsurancePct}%`}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Last checked: {date(stages.eligibility.checkedAt)}
                </Typography>
                {["NEEDS_REVIEW", "FAILED"].includes(stages.eligibility.status) && (
                  <Button
                    variant="outlined"
                    color="warning"
                    size="small"
                    startIcon={<Visibility />}
                    onClick={() =>
                      navigate(`/claims/${claim.id}`, {
                        state: {
                          ...claimReturnState(),
                          focus: "eligibility"
                        }
                      })
                    }
                  >
                    Review / Fix
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  disabled={action === "eligibility" || eligibilityComplete}
                  onClick={() =>
                    runAction(
                      "eligibility",
                      () => ClaimsApi.runEligibilityPrecheck(claim.id),
                      "Eligibility pre-check completed"
                    )
                  }
                >
                  {action === "eligibility"
                    ? "Checking..."
                    : eligibilityComplete
                    ? "Pre-check Passed"
                    : "Run Pre-check"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.priorAuth}
              stageId="journey-stage-prior-auth"
              highlighted={focusedStage === "prior-auth"}
              status={stages.priorAuth.status}
              actionable={stages.priorAuth.actionable}
              blockedReason={stages.priorAuth.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.priorAuth.actionable}>
                  <InputLabel>Auth Required? *</InputLabel>
                  <Select
                    label="Auth Required? *"
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
                  label={authRequired === "YES" ? "Authorization No. *" : "Authorization No."}
                  value={authorizationNo}
                  color={authRequired === "YES" ? "warning" : "primary"}
                  focused={authRequired === "YES" && !authorizationNo}
                  onChange={(e) => setAuthorizationNo(e.target.value)}
                  disabled={!stages.priorAuth.actionable || authRequired !== "YES"}
                />
                <TextField
                  size="small"
                  label="End Date / Expiry"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={authExpiry}
                  onChange={(e) => setAuthExpiry(e.target.value)}
                  disabled={!stages.priorAuth.actionable || authRequired !== "YES"}
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={
                    !stages.priorAuth.actionable ||
                    action === "auth" ||
                    authRequired === "" ||
                    authFormMatchesSaved
                  }
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
                  {action === "auth"
                    ? "Saving..."
                    : authFormMatchesSaved &&
                      ["APPROVED", "NOT_REQUIRED"].includes(stages.priorAuth.status)
                    ? "Up to date"
                    : "Evaluate"}
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
                <Typography variant="body2"><b>Claimed *:</b> {money(claim.amount)}</Typography>
                <Typography variant="body2"><b>Billed:</b> {money(claim.totalBilledAmount)}</Typography>
                <Typography variant="body2"><b>Documents *:</b> {claim.documents?.length || 0}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Submitted: {date(stages.claim.submissionDate)}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={!stages.claim.actionable}
                  onClick={() =>
                    navigate(`/claims/${claim.id}`, {
                      state: claimReturnState()
                    })
                  }
                >
                  Open Claim
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.claimStatus}
              stageId="journey-stage-claim-status"
              highlighted={focusedStage === "claim-status"}
              status={stages.claimStatus.status}
              actionable={stages.claimStatus.actionable}
              blockedReason={stages.claimStatus.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.claimStatus.actionable}>
                  <InputLabel>Payer Status *</InputLabel>
                  <Select
                    label="Payer Status *"
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
                  disabled={
                    !stages.claimStatus.actionable ||
                    action === "status" ||
                    payerStatusUnchanged
                  }
                  onClick={() =>
                    runAction(
                      "status",
                      () => ClaimsApi.updatePayerStatus(claim.id, payerStatus),
                      "Payer claim status recorded"
                    )
                  }
                >
                  {action === "status"
                    ? "Saving..."
                    : payerStatusUnchanged
                    ? "Status up to date"
                    : "Record Status"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.remittance}
              stageId="journey-stage-remittance"
              highlighted={focusedStage === "remittance"}
              status={stages.remittance.status}
              actionable={stages.remittance.actionable}
              blockedReason={stages.remittance.blockedReason}
            >
              <Stack spacing={1.2}>
                <FormControl size="small" fullWidth disabled={!stages.remittance.actionable}>
                  <InputLabel>Remittance *</InputLabel>
                  <Select
                    label="Remittance *"
                    value={remittanceStatus}
                    onChange={(e) => setRemittanceStatus(e.target.value)}
                  >
                    <MenuItem value="AWAITING">Awaiting</MenuItem>
                    <MenuItem value="RECEIVED">Received</MenuItem>
                    <MenuItem value="POSTED">Posted</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  type="number"
                  label={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus)
                      ? "Allowed Amount *"
                      : "Allowed Amount"
                  }
                  value={allowedAmount}
                  color={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus) &&
                    allowedAmount === ""
                      ? "warning"
                      : "primary"
                  }
                  focused={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus) &&
                    allowedAmount === ""
                  }
                  onChange={(e) => setAllowedAmount(e.target.value)}
                  disabled={!stages.remittance.actionable}
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    patientResponsibilityManual
                      ? "Patient Responsibility"
                      : "Patient Responsibility (estimated)"
                  }
                  value={patientResponsibility}
                  onChange={(e) => {
                    setPatientResponsibility(e.target.value);
                    setPatientResponsibilityManual(true);
                  }}
                  disabled={!stages.remittance.actionable}
                  helperText={
                    patientResponsibilityManual
                      ? "Entered value"
                      : "Auto-calculated; editable"
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus)
                      ? "Paid Amount *"
                      : "Paid Amount"
                  }
                  value={paidAmount}
                  color={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus) &&
                    paidAmount === ""
                      ? "warning"
                      : "primary"
                  }
                  focused={
                    ["RECEIVED", "POSTED"].includes(remittanceStatus) &&
                    paidAmount === ""
                  }
                  onChange={(e) => setPaidAmount(e.target.value)}
                  disabled={!stages.remittance.actionable}
                />
                {patientResponsibilityManual && stages.remittance.actionable && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setPatientResponsibilityManual(false)}
                  >
                    Recalculate patient responsibility
                  </Button>
                )}
                <TextField
                  size="small"
                  label="Payment Reference"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  disabled={!stages.remittance.actionable}
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={
                    !stages.remittance.actionable ||
                    action === "remittance" ||
                    !remittanceDirty
                  }
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
                  {action === "remittance"
                    ? "Saving..."
                    : !remittanceDirty
                    ? "Remittance up to date"
                    : "Record Remittance"}
                </Button>
              </Stack>
            </StageCard>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Alert severity="success" icon={<CheckCircle />}>
            Completed stages are locked until a relevant value changes.
          </Alert>
        </>
      )}

      {!loadingJourney && !claim && !pageError && !loadingClaims && (
        <Alert severity="info">
          Select a recent claim or search by patient, member ID, policy, payer, claim number, or authorization number.
        </Alert>
      )}
    </Box>
  );
}
