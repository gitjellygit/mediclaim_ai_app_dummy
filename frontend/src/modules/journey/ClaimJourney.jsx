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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { formatUSD } from "../../utils/currency.js";

const STAGE_LABELS = {
  eligibility: "1. Eligibility",
  priorAuth: "2. Prior Authorization",
  claim: "3. Claim Submission",
  claimStatus: "4. Claim Status",
  remittance: "5. Remittance"
};

const money = formatUSD;

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
  if (["FAILED", "DENIED", "REJECTED"].includes(status)) return "error";
  if (["NEEDS_REVIEW", "REQUIRED", "IN_REVIEW", "PARTIALLY_APPROVED", "PENDED"].includes(status)) return "warning";
  return "default";
}

function humanStatus(status) {
  return String(status || "NOT_AVAILABLE")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePayerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function journeyStepState(key, stages) {
  if (!stages) return "pending";

  if (key === "eligibility") {
    if (stages.eligibility?.status === "VERIFIED") return "complete";
    if (["FAILED", "NEEDS_REVIEW"].includes(stages.eligibility?.status)) return "attention";
    return "active";
  }

  if (key === "prior-auth") {
    if (["APPROVED", "NOT_REQUIRED"].includes(stages.priorAuth?.status)) return "complete";
    if (["DENIED", "NEEDS_REVIEW", "REQUIRED"].includes(stages.priorAuth?.status)) return "attention";
    return stages.eligibility?.status === "VERIFIED" ? "active" : "pending";
  }

  if (key === "claim") {
    if (["SUBMITTED", "PAID"].includes(stages.claim?.status)) return "complete";
    return ["APPROVED", "NOT_REQUIRED"].includes(stages.priorAuth?.status)
      ? "active"
      : "pending";
  }

  if (key === "claim-status") {
    const status = stages.claimStatus?.status;
    if (["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(status)) return "complete";
    if (["DENIED"].includes(status)) return "attention";
    return ["SUBMITTED", "PAID"].includes(stages.claim?.status)
      ? "active"
      : "pending";
  }

  if (key === "remittance") {
    const status = stages.remittance?.status;
    if (["RECEIVED", "POSTED"].includes(status)) return "complete";
    return ["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(
      stages.claimStatus?.status
    )
      ? "active"
      : "pending";
  }

  return "pending";
}

function JourneyProgress({ stages, onStepClick, payerConnectionRequired }) {
  const steps = [
    { key: "eligibility", label: "Eligibility" },
    { key: "prior-auth", label: "Prior Auth" },
    { key: "claim", label: "Claim" },
    { key: "claim-status", label: "Status" },
    { key: "remittance", label: "Remittance" }
  ];

  const stateStyles = {
    complete: {
      circleBg: "success.main",
      circleColor: "success.contrastText",
      textColor: "success.main"
    },
    active: {
      circleBg: "primary.main",
      circleColor: "primary.contrastText",
      textColor: "primary.main"
    },
    attention: {
      circleBg: "warning.main",
      circleColor: "warning.contrastText",
      textColor: "warning.dark"
    },
    pending: {
      circleBg: "grey.300",
      circleColor: "text.secondary",
      textColor: "text.secondary"
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        pb: 0.5,
        "&::-webkit-scrollbar": { height: 5 }
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          minWidth: { xs: 700, md: "100%" },
          px: { xs: 0.5, sm: 1 }
        }}
      >
        {steps.map((step, index) => {
          const rawState = journeyStepState(step.key, stages);
          const state =
            payerConnectionRequired && ["eligibility", "prior-auth"].includes(step.key)
              ? "pending"
              : rawState;
          const style = stateStyles[state];
          const previousState =
            index > 0 ? journeyStepState(steps[index - 1].key, stages) : null;
          const connectorComplete = previousState === "complete";

          return (
            <React.Fragment key={step.key}>
              {index > 0 && (
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 52,
                    height: 3,
                    mt: 2,
                    mx: 1,
                    borderRadius: 99,
                    backgroundColor: connectorComplete
                      ? "success.main"
                      : "grey.300",
                    transition: "background-color 0.25s ease"
                  }}
                />
              )}

              <Box
                role="button"
                tabIndex={0}
                onClick={() => onStepClick?.(step.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onStepClick?.(step.key);
                  }
                }}
                sx={{
                  width: 92,
                  flexShrink: 0,
                  textAlign: "center",
                  cursor: "pointer",
                  userSelect: "none"
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    mx: "auto",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "0.82rem",
                    fontWeight: 800,
                    backgroundColor: style.circleBg,
                    color: style.circleColor,
                    boxShadow:
                      state === "active"
                        ? "0 0 0 5px rgba(25,118,210,0.12)"
                        : "none",
                    transition: "all 0.25s ease"
                  }}
                >
                  {state === "complete" ? "✓" : index + 1}
                </Box>
                <Typography
                  variant="body2"
                  fontWeight={state === "pending" ? 500 : 700}
                  sx={{
                    mt: 0.75,
                    color: style.textColor,
                    whiteSpace: "nowrap"
                  }}
                >
                  {step.label}
                </Typography>
              </Box>
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
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
  errorHighlighted = false,
  children
}) {
  return (
    <Card
      id={stageId}
      data-testid={stageId}
      sx={{
        height: "100%",
        opacity: 1,
        backgroundColor: actionable ? "background.paper" : "grey.50",
        scrollMarginTop: 96,
        border: highlighted || errorHighlighted ? "2px solid" : undefined,
        borderColor: errorHighlighted
          ? "error.main"
          : highlighted
          ? "warning.main"
          : undefined,
        boxShadow: highlighted || errorHighlighted ? 4 : undefined
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
  const [mockPayers, setMockPayers] = React.useState([]);
  const [selectedMockPayer, setSelectedMockPayer] = React.useState("");
  const [externalConnectors, setExternalConnectors] = React.useState([]);
  const [selectedExternalConnector, setSelectedExternalConnector] = React.useState("");
  const [externalPayerCode, setExternalPayerCode] = React.useState("");
  const [payerEditing, setPayerEditing] = React.useState(false);
  const [activityExpanded, setActivityExpanded] = React.useState(false);

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
  const [remittanceDialogOpen, setRemittanceDialogOpen] = React.useState(false);
  const [remittanceDialogData, setRemittanceDialogData] = React.useState(null);
  const [submissionBlock, setSubmissionBlock] = React.useState(null);
  const [submissionBlockDialogOpen, setSubmissionBlockDialogOpen] = React.useState(false);

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
      const latestCheck = Array.isArray(claim.checks) ? claim.checks[0] : null;
      const latestIssues = Array.isArray(latestCheck?.issues) ? latestCheck.issues : [];
      if (
        latestCheck &&
        !latestCheck.isStale &&
        Number(latestCheck.score) >= 80 &&
        !latestIssues.some((issue) => issue?.severity === "BLOCK")
      ) {
        setSubmissionBlock(null);
      }
      setSelectedMockPayer(data?.payerConnection?.simulatedPayerCode || "");
      setSelectedExternalConnector(
        data?.payerConnection?.mode === "LIVE" ? claim.payerConnectorId || "" : ""
      );
      setExternalPayerCode(claim.payerEdiId || "");
      setPayerEditing(false);
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

      const currentAllowed = claim.allowedAmount == null ? null : Number(claim.allowedAmount);
      const currentPaid = claim.paidAmount == null ? null : Number(claim.paidAmount);
      const derivedPatientResponsibility =
        currentAllowed != null && currentPaid != null &&
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
    ClaimsApi.getMockPayers()
      .then((data) => setMockPayers(Array.isArray(data?.payers) ? data.payers : []))
      .catch(() => setMockPayers([]));

    ClaimsApi.getPayerConnectors()
      .then((data) =>
        setExternalConnectors(
          Array.isArray(data?.connectors)
            ? data.connectors.filter(
                (connector) =>
                  connector?.mode === "LIVE" &&
                  connector?.configured &&
                  ["SANDBOX", "TEST"].includes(connector?.environment)
              )
            : []
        )
      )
      .catch(() => setExternalConnectors([]));
  }, []);

  React.useEffect(() => {
    if (routeInitializedRef.current) return;
    routeInitializedRef.current = true;

    const initialClaimId = searchParams.get("claimId");

    loadClaims("");

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

  function goToClaimFixes() {
    if (!claim?.id) return;
    setSubmissionBlockDialogOpen(false);
    navigate(`/claims/${claim.id}?section=readiness`, {
      state: claimReturnState()
    });
  }

  function showSubmissionBlock(readiness, fallbackMessage = "") {
    const issues = Array.isArray(readiness?.issues)
      ? readiness.issues.filter((issue) => issue?.severity === "BLOCK")
      : [];
    const score = Number.isFinite(Number(readiness?.score))
      ? Number(readiness.score)
      : null;

    setSubmissionBlock({
      score,
      issues,
      message:
        fallbackMessage ||
        (issues.length
          ? `${issues.length} blocking issue${issues.length === 1 ? "" : "s"} must be fixed before submission.`
          : score != null && score < 80
          ? `Claim readiness is ${score}%. A score of at least 80% is required before submission.`
          : "This claim needs attention before it can be submitted.")
    });
    setSubmissionBlockDialogOpen(true);
  }

  const connectedConnector = journey?.payerConnection?.connector || null;
  const simulatedPayerConnected =
    journey?.payerConnection?.mode === "SIMULATED" &&
    Boolean(journey?.payerConnection?.simulatedPayerCode);
  const externalPayerConnected =
    journey?.payerConnection?.mode === "LIVE" &&
    Boolean(claim?.payerConnectorId) &&
    Boolean(connectedConnector?.configured);
  const payerConnected = simulatedPayerConnected || externalPayerConnected;
  const availableExternalConnectors = externalConnectors.filter(
    (connector) => connector?.configured
  );
  const claimPayerName = normalizePayerName(claim?.payerName);
  const matchingMockPayers = claimPayerName
    ? mockPayers.filter(
        (payer) => normalizePayerName(payer.name) === claimPayerName
      )
    : [];
  const suggestedMockPayer =
    !payerConnected && matchingMockPayers.length === 1
      ? matchingMockPayers[0]
      : null;
  const payerNameProvenance = claim?.fieldProvenance?.payerName || null;
  const externalPriorAuthSupported =
    externalPayerConnected &&
    connectedConnector?.capabilities?.includes("requestPriorAuth");
  const externalSubmissionSupported =
    externalPayerConnected &&
    connectedConnector?.capabilities?.includes("submitClaim");
  const externalStatusSupported =
    externalPayerConnected &&
    connectedConnector?.capabilities?.includes("getStatus");
  const payerTransactions = claim?.payerTransactions || [];
  const workflowAdvanced =
    Boolean(claim?.claimSubmissionDate) ||
    ["SUBMITTED", "DENIED", "PAID"].includes(claim?.status || "") ||
    Boolean(claim?.payerClaimStatus) ||
    ["RECEIVED", "POSTED"].includes(claim?.remittanceStatus || "");
  const payerConnectionRequired = !payerConnected && !workflowAdvanced;
  const historicalConnectionUnavailable = workflowAdvanced && !payerConnected;
  const submissionTransaction = payerTransactions.find(
    (tx) => tx.transactionType === "CLAIM_SUBMISSION"
  );
  const internalClaimSubmitted =
    Boolean(claim?.claimSubmissionDate) ||
    ["SUBMITTED", "DENIED", "PAID"].includes(claim?.status || "");
  const acknowledged = ["ACCEPTED", "PENDED"].includes(submissionTransaction?.status);
  const latestRemittance = payerTransactions.find(
    (tx) => tx.transactionType === "REMITTANCE"
  );
  const estimatedPatientResponsibility =
    claim?.allowedAmount != null && claim?.approvedAmount != null
      ? Math.max(0, Number(claim.allowedAmount) - Number(claim.approvedAmount))
      : null;
  const finalPayerStatus = ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "PAID"].includes(
    claim?.payerClaimStatus || ""
  );

  function remittanceDisplayData(result = null) {
    const response = result?.result || result || latestRemittance?.responsePayload || {};
    return {
      billedAmount: Number(claim?.amount ?? claim?.totalBilledAmount ?? 0),
      allowedAmount: Number(response.allowedAmount ?? claim?.allowedAmount ?? 0),
      expectedPayerPayment: Number(
        response.expectedPayerPayment ??
          response.approvedAmount ??
          claim?.approvedAmount ??
          0
      ),
      patientResponsibility: Number(
        response.patientResponsibility ?? claim?.patientResponsibility ?? 0
      ),
      paidAmount: Number(response.paidAmount ?? claim?.paidAmount ?? 0),
      paymentReference:
        response.paymentReference || claim?.paymentReference || "—",
      potentialUnderpayment: Number(response.potentialUnderpayment || 0),
      sourceLabel:
        journey?.payerConnection?.mode === "SIMULATED"
          ? "Simulated 835 payer response"
          : "Recorded remittance",
      receivedAt: claim?.remittanceReceivedAt || latestRemittance?.createdAt || null
    };
  }

  async function checkConnectedRemittance() {
    setAction("remittance");
    setPageError("");
    try {
      const result = await ClaimsApi.simulatePayerRemittance(claim.id);
      await loadJourney(claim.id);

      if (result?.available === false) {
        showToast(
          result.message || "No remittance is available yet.",
          "info"
        );
        return;
      }

      setRemittanceDialogData(remittanceDisplayData(result));
      setRemittanceDialogOpen(true);
      if (!result?.unchanged) {
        showToast("Remittance received and posted", "success");
      }
    } catch (error) {
      const message = error.message || "Unable to check remittance";
      setPageError(message);
      showToast(message, "error");
    } finally {
      setAction("");
    }
  }

  function viewPostedRemittance() {
    setRemittanceDialogData(remittanceDisplayData());
    setRemittanceDialogOpen(true);
  }

  async function submitConnectedClaim() {
    setAction("payer-submit");
    setPageError("");
    try {
      if (!claim.claimSubmissionDate && claim.status !== "SUBMITTED") {
        const readiness = await ClaimsApi.runCheck(claim.id);
        const blockers = Array.isArray(readiness?.issues)
          ? readiness.issues.filter((issue) => issue?.severity === "BLOCK")
          : [];

        if (blockers.length > 0 || Number(readiness?.score || 0) < 80) {
          showSubmissionBlock(readiness);
          await loadJourney(claim.id);
          return;
        }

        await ClaimsApi.submit(claim.id);
      }

      const result = await ClaimsApi.simulatePayerSubmission(claim.id);
      setSubmissionBlock(null);
      await loadJourney(claim.id);
      if (!result?.unchanged) showToast("Claim sent to payer", "success");
    } catch (error) {
      const message = error.message || "Unable to submit claim";
      const submissionPrerequisiteError =
        error?.status === 400 &&
        /blocking issues|readiness|AI Check|eligibility|prior authorization/i.test(message);

      if (submissionPrerequisiteError) {
        showSubmissionBlock(null, message);
      } else {
        setPageError(message);
        showToast(message, "error");
      }
    } finally {
      setAction("");
    }
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
          <Typography color="text.secondary" variant="body2">
            Track the claim from eligibility through payment.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {location.state?.from && (
            <Button
              variant="outlined"
              onClick={() => navigate(location.state.from)}
            >
              {location.state?.backLabel || "Back"}
            </Button>
          )}
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
      </Stack>

      {claim && stages && (
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 1.5, sm: 2 },
            mb: 3,
            borderRadius: 2,
            backgroundColor: "background.paper"
          }}
        >
          <JourneyProgress
            stages={stages}
            payerConnectionRequired={payerConnectionRequired}
            onStepClick={(step) => {
              const element = document.getElementById(`journey-stage-${step}`);
              if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
          />
        </Paper>
      )}

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
              label="Choose a Claim"
              placeholder="Search patient, member ID, policy, payer, claim or authorization no."
              helperText={
                searchText.trim()
                  ? "Showing the best matching claims"
                  : "Select a claim to view its complete journey"
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
                    View Claim Details
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card
            sx={{
              mb: 3,
              border: payerConnectionRequired ? "2px solid" : undefined,
              borderColor: payerConnectionRequired ? "warning.main" : undefined,
              boxShadow: payerConnectionRequired ? 4 : undefined,
              backgroundColor: payerConnectionRequired ? "warning.50" : "background.paper"
            }}
            data-testid="payer-connection-card"
          >
            <CardContent>
              <Stack spacing={2}>
                {payerConnectionRequired && (
                  <Alert severity="warning" icon={<Lock fontSize="inherit" />}>
                    <b>Payer connection required.</b> Connect the payer first to unlock Eligibility and Prior Authorization.
                  </Alert>
                )}
                {historicalConnectionUnavailable && (
                  <Alert severity="info">
                    <b>No payer connection record is available for this historical claim.</b>{" "}
                    No action is required because this claim has already advanced beyond the pre-submission workflow.
                  </Alert>
                )}
                {!workflowAdvanced &&
                  !payerConnected &&
                  availableExternalConnectors.length > 0 && (
                    <Paper
                      variant="outlined"
                      sx={{ p: 1.5, borderStyle: "dashed" }}
                      data-testid="external-payer-connector"
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          External sandbox/test connector
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Connect a configured non-production payer connector for demo eligibility.
                        </Typography>
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={1}
                          alignItems={{ md: "center" }}
                        >
                          <FormControl size="small" sx={{ minWidth: 220 }}>
                            <InputLabel>Connector</InputLabel>
                            <Select
                              label="Connector"
                              value={selectedExternalConnector}
                              onChange={(event) =>
                                setSelectedExternalConnector(event.target.value)
                              }
                              data-testid="external-connector-select"
                            >
                              <MenuItem value="">Choose connector</MenuItem>
                              {availableExternalConnectors.map((connector) => (
                                <MenuItem key={connector.id} value={connector.id}>
                                  {connector.provider} · {humanStatus(connector.environment)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <TextField
                            size="small"
                            label="Payer EDI ID"
                            value={externalPayerCode}
                            onChange={(event) => setExternalPayerCode(event.target.value)}
                            inputProps={{ "aria-label": "External payer EDI ID" }}
                          />
                          <Button
                            variant="contained"
                            disabled={
                              !selectedExternalConnector ||
                              !externalPayerCode.trim() ||
                              action === "payer-connect"
                            }
                            onClick={() =>
                              runAction(
                                "payer-connect",
                                () =>
                                  ClaimsApi.connectExternalPayer(claim.id, {
                                    connectorId: selectedExternalConnector,
                                    payerCode: externalPayerCode.trim(),
                                    payerName: claim.payerName || undefined
                                  }),
                                "External payer connected"
                              )
                            }
                          >
                            {action === "payer-connect" ? "Connecting..." : "Connect external"}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  )}

                <Stack
                  direction={{ xs: "column", md: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "stretch", md: "center" }}
                  spacing={2}
                >
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                      <Typography variant="h6" fontWeight={800}>
                        Payer Connection
                      </Typography>
                      {payerConnected && (
                        <Chip size="small" color="success" label="Connected" />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {journey?.payerConnection?.simulatedPayer?.description ||
                        (externalPayerConnected
                          ? `${connectedConnector?.provider || "External"} ${String(
                              connectedConnector?.environment || ""
                            ).toLowerCase()} connector`
                          : historicalConnectionUnavailable
                          ? "Historical payer activity is shown below when available."
                          : "Select and connect the claim payer before starting eligibility or prior authorization.")}
                      {simulatedPayerConnected && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                          Demo environment · Illustrative responses; no live payer connection
                        </Typography>
                      )}
                      {externalPayerConnected && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                          {connectedConnector?.environment === "TEST"
                            ? "Test environment · Responses are not production payer verification"
                            : "External payer connector"}
                        </Typography>
                      )}
                    </Typography>
                  </Box>

                  {workflowAdvanced ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent={{ md: "flex-end" }}
                      sx={{ minWidth: { md: 360 } }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Payer
                      </Typography>
                      <Chip
                        variant="outlined"
                        color={payerConnected ? "success" : "default"}
                        label={
                          journey?.payerConnection?.simulatedPayer?.name ||
                          claim.payerName ||
                          "Connection record unavailable"
                        }
                      />
                    </Stack>
                  ) : externalPayerConnected ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent={{ md: "flex-end" }}
                      sx={{ minWidth: { md: 360 } }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Payer
                      </Typography>
                      <Chip
                        variant="outlined"
                        color="success"
                        label={claim.payerName || connectedConnector?.provider || "External payer"}
                      />
                    </Stack>
                  ) : simulatedPayerConnected && !payerEditing ? (
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      alignItems={{ xs: "stretch", sm: "center" }}
                      justifyContent={{ md: "flex-end" }}
                      sx={{ minWidth: { md: 430 } }}
                    >
                      <TextField
                        size="small"
                        label="Payer"
                        value={journey?.payerConnection?.simulatedPayer?.name || claim.payerName || ""}
                        InputProps={{ readOnly: true }}
                        data-testid="connected-payer"
                        fullWidth
                      />
                      <Button
                        variant="outlined"
                        onClick={() => setPayerEditing(true)}
                        disabled={action !== ""}
                      >
                        Change payer
                      </Button>
                    </Stack>
                  ) : suggestedMockPayer && !payerEditing ? (
                    <Stack
                      spacing={0.75}
                      sx={{ minWidth: { md: 430 } }}
                      data-testid="suggested-payer-confirmation"
                    >
                      <Typography variant="caption" color="text.secondary">
                        {payerNameProvenance?.source === "DOCUMENT_AI"
                          ? "Payer detected from uploaded document"
                          : "Payer matched from claim information"}
                      </Typography>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        alignItems={{ xs: "stretch", sm: "center" }}
                      >
                        <TextField
                          size="small"
                          label="Suggested payer"
                          value={suggestedMockPayer.name}
                          InputProps={{ readOnly: true }}
                          fullWidth
                        />
                        <Button
                          variant="contained"
                          disabled={action === "payer-connect"}
                          onClick={async () => {
                            setSelectedMockPayer(suggestedMockPayer.code);
                            const result = await runAction(
                              "payer-connect",
                              () => ClaimsApi.connectMockPayer(claim.id, suggestedMockPayer.code),
                              "Payer connected"
                            );
                            if (result) setPayerEditing(false);
                          }}
                        >
                          {action === "payer-connect" ? "Connecting..." : "Confirm payer"}
                        </Button>
                        <Button
                          variant="text"
                          onClick={() => {
                            setSelectedMockPayer("");
                            setPayerEditing(true);
                          }}
                          disabled={action !== ""}
                        >
                          Choose different
                        </Button>
                      </Stack>
                    </Stack>
                  ) : (
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ minWidth: { md: 430 } }}
                    >
                      <FormControl size="small" fullWidth>
                        <InputLabel>Payer</InputLabel>
                        <Select
                          label="Payer"
                          data-testid="payer-select"
                          value={selectedMockPayer}
                          onChange={(e) => setSelectedMockPayer(e.target.value)}
                        >
                          <MenuItem value="">Choose payer</MenuItem>
                          {mockPayers.map((payer) => (
                            <MenuItem key={payer.code} value={payer.code}>
                              {payer.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="contained"
                        disabled={
                          !selectedMockPayer ||
                          action === "payer-connect" ||
                          (simulatedPayerConnected &&
                            journey?.payerConnection?.simulatedPayerCode === selectedMockPayer)
                        }
                        onClick={async () => {
                          const result = await runAction(
                            "payer-connect",
                            () => ClaimsApi.connectMockPayer(claim.id, selectedMockPayer),
                            payerConnected ? "Payer changed" : "Payer connected"
                          );
                          if (result) setPayerEditing(false);
                        }}
                      >
                        {action === "payer-connect" ? "Connecting..." : "Connect"}
                      </Button>
                      {(simulatedPayerConnected || suggestedMockPayer) && payerEditing && (
                        <Button
                          variant="text"
                          onClick={() => {
                            setSelectedMockPayer(journey?.payerConnection?.simulatedPayerCode || "");
                            setPayerEditing(false);
                          }}
                          disabled={action !== ""}
                        >
                          Cancel
                        </Button>
                      )}
                    </Stack>
                  )}
                </Stack>

                {payerConnected && (
                  <>
                    <Divider />
                    <Box>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "stretch", sm: "center" }}
                        spacing={1}
                      >
                        <Box>
                          <Typography variant="subtitle2" fontWeight={800}>
                            Payer Activity
                          </Typography>
                          {payerTransactions.length > 0 ? (
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                              <Typography variant="body2" color="text.secondary">
                                Latest: {humanStatus(payerTransactions[0].transactionType)}
                              </Typography>
                              <Chip
                                size="small"
                                color={stageColor(payerTransactions[0].status)}
                                label={humanStatus(payerTransactions[0].status)}
                              />
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              No payer activity yet. Start with Eligibility below.
                            </Typography>
                          )}
                        </Box>

                        {payerTransactions.length > 0 && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => setActivityExpanded((value) => !value)}
                            data-testid="payer-activity-toggle"
                          >
                            {activityExpanded
                              ? "Hide activity"
                              : `Show activity (${payerTransactions.length})`}
                          </Button>
                        )}
                      </Stack>

                      {activityExpanded && payerTransactions.length > 0 && (
                        <Stack spacing={1} sx={{ mt: 1.25 }} data-testid="payer-activity-history">
                          {payerTransactions.map((tx) => (
                            <Paper key={tx.id} variant="outlined" sx={{ p: 1.25 }}>
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                justifyContent="space-between"
                                spacing={1}
                              >
                                <Box>
                                  <Typography variant="body2" fontWeight={700}>
                                    {humanStatus(tx.transactionType)}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {tx.transactionId} • {tx.latencyMs || 0} ms
                                  </Typography>
                                </Box>
                                <Chip
                                  size="small"
                                  color={stageColor(tx.status)}
                                  label={humanStatus(tx.status)}
                                />
                              </Stack>
                              {tx.responsePayload?.reason && (
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                  {tx.responsePayload.reason}
                                </Typography>
                              )}
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </>
                )}
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
              actionable={payerConnected && stages.eligibility.actionable}
              blockedReason={
                payerConnectionRequired
                  ? "Connect the payer above to unlock Eligibility."
                  : historicalConnectionUnavailable
                  ? "Historical claim — eligibility is read-only because this claim has already advanced."
                  : stages.eligibility.blockedReason
              }
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
                  disabled={!payerConnected || action !== "" || eligibilityComplete}
                  onClick={() =>
                    runAction(
                      "eligibility",
                      () =>
                        externalPayerConnected
                          ? ClaimsApi.runEligibilityPrecheck(claim.id)
                          : ClaimsApi.simulatePayerEligibility(claim.id),
                      "Eligibility updated"
                    )
                  }
                >
                  {action === "eligibility"
                    ? "Checking..."
                    : eligibilityComplete
                    ? "Eligibility Current"
                    : "Check Eligibility"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.priorAuth}
              stageId="journey-stage-prior-auth"
              highlighted={focusedStage === "prior-auth"}
              status={stages.priorAuth.status}
              actionable={payerConnected && stages.priorAuth.actionable}
              blockedReason={
                payerConnectionRequired
                  ? "Connect the payer above before checking Prior Authorization."
                  : historicalConnectionUnavailable
                  ? "Historical claim — prior authorization is read-only because this claim has already advanced."
                  : stages.priorAuth.blockedReason
              }
            >
              <Stack spacing={1.2}>
                {payerConnected ? (
                  <Typography variant="body2">
                    <b>Authorization Required:</b>{" "}
                    {claim.priorAuthRequired == null
                      ? "Not checked"
                      : claim.priorAuthRequired
                      ? "Yes"
                      : "No"}
                  </Typography>
                ) : (
                  <FormControl size="small" fullWidth disabled={!payerConnected || !stages.priorAuth.actionable}>
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
                )}
                <TextField
                  size="small"
                  label={authRequired === "YES" ? "Authorization No. *" : "Authorization No."}
                  value={authorizationNo}
                  color={authRequired === "YES" ? "warning" : "primary"}
                  focused={authRequired === "YES" && !authorizationNo}
                  onChange={(e) => setAuthorizationNo(e.target.value)}
                  disabled={
                    !payerConnected ||
                    !stages.priorAuth.actionable ||
                    (payerConnected
                      ? claim.priorAuthRequired !== true
                      : authRequired !== "YES")
                  }
                />
                <TextField
                  size="small"
                  label="End Date / Expiry"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={authExpiry}
                  onChange={(e) => setAuthExpiry(e.target.value)}
                  disabled={
                    !payerConnected ||
                    !stages.priorAuth.actionable ||
                    (payerConnected
                      ? claim.priorAuthRequired !== true
                      : authRequired !== "YES")
                  }
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={
                    !payerConnected ||
                    !stages.priorAuth.actionable ||
                    action !== "" ||
                    (externalPayerConnected && !externalPriorAuthSupported) ||
                    (payerConnected
                      ? ["APPROVED", "NOT_REQUIRED"].includes(stages.priorAuth.status)
                      : authRequired === "" || authFormMatchesSaved)
                  }
                  onClick={() =>
                    runAction(
                      "auth",
                      () =>
                        ClaimsApi.simulatePayerPriorAuth(claim.id, {
                          authorizationNo
                        }),
                      "Prior authorization updated"
                    )
                  }
                >
                  {action === "auth"
                    ? "Checking..."
                    : externalPayerConnected && !externalPriorAuthSupported
                    ? "Not Available"
                    : ["APPROVED", "NOT_REQUIRED"].includes(stages.priorAuth.status)
                    ? "Authorization Current"
                    : "Check Prior Auth"}
                </Button>
              </Stack>
            </StageCard>

            <StageCard
              title={STAGE_LABELS.claim}
              stageId="journey-stage-claim"
              highlighted={focusedStage === "claim"}
              errorHighlighted={Boolean(submissionBlock)}
              status={stages.claim.status}
              actionable={stages.claim.actionable}
              blockedReason={stages.claim.blockedReason}
            >
              <Stack spacing={1.2}>
                {submissionBlock && (
                  <Alert
                    severity="error"
                    data-testid="submission-blocked-alert"
                    action={
                      <Button color="inherit" size="small" onClick={goToClaimFixes}>
                        Fix Claim
                      </Button>
                    }
                  >
                    {submissionBlock.message}
                  </Alert>
                )}
                <Typography variant="body2"><b>Claimed *:</b> {money(claim.amount)}</Typography>
                <Typography variant="body2"><b>Billed:</b> {money(claim.totalBilledAmount)}</Typography>
                <Typography variant="body2"><b>Documents *:</b> {claim.documents?.length || 0}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Submitted: {date(stages.claim.submissionDate)}
                </Typography>
                {(simulatedPayerConnected || externalSubmissionSupported) && (
                  <>
                    {submissionTransaction ? (
                      <Button variant="contained" size="small" disabled>
                        Sent to Payer
                      </Button>
                    ) : internalClaimSubmitted ? (
                      <Alert
                        severity="info"
                        data-testid="payer-transmission-pending"
                        action={
                          <Button
                            color="inherit"
                            size="small"
                            disabled={action !== ""}
                            onClick={submitConnectedClaim}
                          >
                            {action === "payer-submit"
                              ? "Transmitting..."
                              : "Transmit to Payer"}
                          </Button>
                        }
                      >
                        Claim submission is complete. Payer transmission is a separate step.
                      </Alert>
                    ) : (
                      <Button
                        variant="contained"
                        size="small"
                        disabled={action !== "" || !stages.claim.actionable}
                        onClick={submitConnectedClaim}
                      >
                        {action === "payer-submit" ? "Submitting..." : "Submit to Payer"}
                      </Button>
                    )}
                  </>
                )}
                <Button
                  variant="outlined"
                  color={submissionBlock ? "error" : "primary"}
                  size="small"
                  disabled={!stages.claim.actionable}
                  onClick={() =>
                    submissionBlock
                      ? goToClaimFixes()
                      : navigate(`/claims/${claim.id}`, {
                          state: claimReturnState()
                        })
                  }
                >
                  {submissionBlock ? "Fix in Claim Details" : "View Claim Details"}
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
                {payerConnected ? (
                  <Typography variant="body2">
                    <b>Current Status:</b> {humanStatus(stages.claimStatus.status)}
                  </Typography>
                ) : (
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
                )}
                <Typography variant="caption" color="text.secondary">
                  Last updated: {date(stages.claimStatus.checkedAt)}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  disabled={
                    !stages.claimStatus.actionable ||
                    action !== "" ||
                    (simulatedPayerConnected
                      ? finalPayerStatus || !acknowledged
                      : externalPayerConnected
                      ? finalPayerStatus || !externalStatusSupported
                      : payerStatusUnchanged)
                  }
                  onClick={() =>
                    runAction(
                      "status",
                      () =>
                        simulatedPayerConnected
                          ? ClaimsApi.simulatePayerStatus(claim.id)
                          : externalPayerConnected
                          ? ClaimsApi.refreshPayerStatus(claim.id)
                          : ClaimsApi.updatePayerStatus(claim.id, payerStatus),
                      externalPayerConnected
                        ? "276/277 claim status refreshed"
                        : "Payer status updated"
                    )
                  }
                >
                  {action === "status"
                    ? "Checking..."
                    : finalPayerStatus
                    ? "Final Status"
                    : externalPayerConnected && !externalStatusSupported
                    ? "276/277 Not Configured"
                    : externalPayerConnected
                    ? "Refresh 276/277 Status"
                    : "Check Status"}
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
              <Stack spacing={1.5}>
                {claim.remittanceStatus === "POSTED" ? (
                  <>
                    <Alert severity="success">
                      {payerConnected
                        ? "Remittance received and posted. Payer-reported values are locked."
                        : "Remittance posted. Posted payment values are locked."}
                    </Alert>

                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                          gap: 1.5
                        }}
                      >
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Allowed Amount
                          </Typography>
                          <Typography fontWeight={700}>{money(claim.allowedAmount)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Expected Payer Payment
                          </Typography>
                          <Typography fontWeight={700}>{money(claim.approvedAmount)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Patient Responsibility
                          </Typography>
                          <Typography fontWeight={700}>{money(claim.patientResponsibility)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Payer Paid
                          </Typography>
                          <Typography fontWeight={700}>{money(claim.paidAmount)}</Typography>
                        </Box>
                        <Box sx={{ gridColumn: { sm: "1 / -1" } }}>
                          <Typography variant="caption" color="text.secondary">
                            Payment Reference
                          </Typography>
                          <Typography fontWeight={700}>{claim.paymentReference || "—"}</Typography>
                        </Box>
                      </Box>
                    </Paper>

                    {payerConnected &&
                      Number(latestRemittance?.responsePayload?.potentialUnderpayment || 0) > 0 && (
                        <Alert
                          severity="warning"
                          action={
                            <Button
                              color="inherit"
                              size="small"
                              onClick={() => navigate("/payments")}
                            >
                              Review Recovery
                            </Button>
                          }
                        >
                          Potential payer underpayment:{" "}
                          {money(latestRemittance.responsePayload.potentialUnderpayment)}.
                          This amount is not patient responsibility.
                        </Alert>
                      )}

                    <Button variant="outlined" size="small" onClick={viewPostedRemittance}>
                      View Remittance Details
                    </Button>
                  </>
                ) : payerConnected ? (
                  <>
                    <Alert severity="info">
                      {["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(
                        claim.payerClaimStatus || ""
                      )
                        ? claim.approvedAmount != null
                          ? `Claim adjudication is complete. Expected payer payment: ${money(claim.approvedAmount)}.`
                          : "Claim adjudication is complete. Refresh to retrieve the remittance."
                        : "Remittance is awaiting payer adjudication. Refresh to check whether an 835 is available yet."}
                    </Alert>

                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<Refresh />}
                      disabled={!stages.remittance.actionable || action !== ""}
                      onClick={checkConnectedRemittance}
                    >
                      {action === "remittance" ? "Refreshing..." : "Refresh Remittance"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Alert severity="info">
                      Enter the remittance values below. Posting the remittance locks the payment values.
                    </Alert>

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
                      label="Allowed Amount"
                      value={allowedAmount}
                      onChange={(e) => setAllowedAmount(e.target.value)}
                      disabled={!stages.remittance.actionable}
                    />

                    {claim.approvedAmount != null && (
                      <TextField
                        size="small"
                        type="number"
                        label="Expected Payer Payment"
                        value={claim.approvedAmount}
                        disabled
                      />
                    )}

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
                      label="Paid Amount"
                      value={paidAmount}
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
                        action !== "" ||
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
                          remittanceStatus === "POSTED"
                            ? "Remittance posted"
                            : "Remittance updated"
                        )
                      }
                    >
                      {action === "remittance"
                        ? "Saving..."
                        : remittanceStatus === "POSTED"
                        ? "Post Remittance"
                        : !remittanceDirty
                        ? "Remittance up to date"
                        : "Save Remittance"}
                    </Button>
                  </>
                )}
              </Stack>
            </StageCard>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Alert severity="success" icon={<CheckCircle />}>
            Completed stages are locked until a relevant value changes.
          </Alert>
        </>
      )}

      <Dialog
        open={submissionBlockDialogOpen}
        onClose={() => setSubmissionBlockDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="submission-blocked-dialog-title"
      >
        <DialogTitle id="submission-blocked-dialog-title">
          Claim needs attention before submission
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            {submissionBlock?.message || "This claim cannot be submitted yet."}
          </Alert>

          {submissionBlock?.score != null && (
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              <b>Readiness score:</b> {submissionBlock.score}%
            </Typography>
          )}

          {submissionBlock?.issues?.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>
                Fix these {submissionBlock.issues.length} blocking issue{submissionBlock.issues.length === 1 ? "" : "s"}:
              </Typography>
              {submissionBlock.issues.map((issue, index) => (
                <Paper key={`${issue.rule || issue.field || "block"}-${index}`} variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="body2">
                    {issue.message || "Claim information needs attention"}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmissionBlockDialogOpen(false)}>
            Close
          </Button>
          <Button variant="contained" color="error" onClick={goToClaimFixes} autoFocus>
            Fix in Claim Details
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={remittanceDialogOpen}
        onClose={() => setRemittanceDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Remittance Received</DialogTitle>
        <DialogContent dividers>
          {remittanceDialogData && (
            <Stack spacing={2}>
              <Alert severity="info">
                {payerConnected
                  ? "Payer-reported values have been posted and locked. They are not manually editable."
                  : "This remittance has been posted and locked. Use the amendment workflow for any correction."}
              </Alert>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.25}>
                  {[
                    ["Billed Amount", remittanceDialogData.billedAmount],
                    ["Allowed Amount", remittanceDialogData.allowedAmount],
                    ["Expected Payer Payment", remittanceDialogData.expectedPayerPayment],
                    ["Patient Responsibility", remittanceDialogData.patientResponsibility],
                    ["Payer Paid", remittanceDialogData.paidAmount]
                  ].map(([label, value]) => (
                    <Stack key={label} direction="row" justifyContent="space-between" spacing={2}>
                      <Typography color="text.secondary">{label}</Typography>
                      <Typography fontWeight={700}>{money(value)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>

              <Box>
                <Typography variant="body2">
                  <b>Payment Reference:</b> {remittanceDialogData.paymentReference}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Source: {remittanceDialogData.sourceLabel}
                  {remittanceDialogData.receivedAt
                    ? ` • Received ${new Date(remittanceDialogData.receivedAt).toLocaleString("en-US")}`
                    : ""}
                </Typography>
              </Box>

              {remittanceDialogData.potentialUnderpayment > 0 && (
                <Alert severity="warning">
                  Potential payer underpayment: {money(remittanceDialogData.potentialUnderpayment)}.
                  This amount is not patient responsibility.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {remittanceDialogData?.potentialUnderpayment > 0 && (
            <Button
              onClick={() => {
                setRemittanceDialogOpen(false);
                navigate("/payments");
              }}
            >
              Review Recovery
            </Button>
          )}
          <Button variant="contained" onClick={() => setRemittanceDialogOpen(false)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {!loadingJourney && !claim && !pageError && !loadingClaims && (
        <Alert severity="info">
          Choose a claim above to view its complete lifecycle, including eligibility, prior authorization, submission, payer status, remittance, and payment activity.
        </Alert>
      )}
    </Box>
  );
}
