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
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  ArrowForward,
  CheckCircleOutline,
  Refresh,
  Schedule,
  Search as SearchIcon,
  WarningAmber
} from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { formatUSD } from "../../utils/currency.js";

const money = formatUSD;

function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US");
}

function percentage(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function priorityColor(priority) {
  if (priority === "CRITICAL") return "error";
  if (priority === "HIGH") return "error";
  if (priority === "MEDIUM") return "warning";
  return "success";
}

function riskColor(level) {
  if (level === "HIGH") return "error";
  if (level === "MED") return "warning";
  if (level === "LOW") return "success";
  return "default";
}

function readinessColor(score) {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "error";
}

function filingColor(state) {
  if (state === "EXPIRED" || state === "URGENT") return "error";
  if (state === "DUE_SOON") return "warning";
  if (state === "ON_TRACK") return "success";
  return "default";
}

function filingLabel(filing) {
  if (!filing || filing.state === "UNKNOWN") return "No deadline";
  if (filing.state === "EXPIRED") {
    return `Expired ${Math.abs(filing.daysRemaining)}d ago`;
  }
  if (filing.daysRemaining === 0) return "Due today";
  return `${filing.daysRemaining}d remaining`;
}

function eligibilityLabel(value) {
  if (value === "VERIFIED") return "Verified";
  if (value === "NEEDS_REVIEW") return "Needs review";
  if (value === "FAILED") return "Failed";
  return "Not checked";
}

function priorAuthLabel(auth) {
  if (auth?.status === "APPROVED") return "Approved";
  if (auth?.status === "NOT_REQUIRED") return "Not required";
  if (auth?.status === "DENIED") return "Denied";
  if (auth?.status === "REQUIRED") return "Required";
  if (auth?.status === "NEEDS_REVIEW") return "Needs review";
  return "Not checked";
}

function nextActionPath(claim) {
  const first = claim?.nextActions?.[0];
  const target = String(first?.target || "").toLowerCase();

  if (target === "eligibility") {
    return `/journey?claimId=${claim.id}&stage=eligibility`;
  }
  if (target === "prior-auth" || target === "prior_auth") {
    return `/journey?claimId=${claim.id}&stage=prior-auth`;
  }
  if (target === "journey") {
    return `/journey?claimId=${claim.id}&stage=claim`;
  }
  if (target === "documents") {
    return `/claims/${claim.id}?section=documents`;
  }
  if (target === "readiness") {
    return `/claims/${claim.id}?section=readiness`;
  }
  return `/claims/${claim.id}`;
}

export default function ApprovalIntelligence() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = React.useState({
    items: [],
    total: 0,
    metrics: null,
    methodology: null
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await ClaimsApi.approvalIntelligence({
        page: page + 1,
        pageSize,
        q: query,
        status
      });

      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        total: Number(result?.total || 0),
        metrics: result?.metrics || null,
        methodology: result?.methodology || null
      });
    } catch (e) {
      setData((current) => ({ ...current, items: [], total: 0 }));
      setError(e?.message || "Approval Intelligence could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, query, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const metrics = data.metrics || {
    totalClaims: 0,
    needsReview: 0,
    readyToSubmit: 0,
    submitted: 0,
    filingRisk: 0,
    totalClaimed: 0,
    readyAmount: 0
  };

  function openClaim(claim, useNextAction = false) {
    navigate(useNextAction ? nextActionPath(claim) : `/claims/${claim.id}`, {
      state: {
        from: location.pathname + location.search,
        backLabel: "Back to Approval Intelligence"
      }
    });
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
            Approval Intelligence
          </Typography>
          <Typography color="text.secondary">
            Pre-submission work queue for claim readiness, eligibility, prior authorization,
            timely filing, coding, and payer risk.
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
        Submission Risk is an explainable rules-based signal from current claim evidence.
        It is not a payer approval probability. Final coverage, medical-necessity, coding,
        contract, and payer-policy decisions remain payer-specific.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(5, minmax(0, 1fr))"
          },
          gap: 2,
          mb: 3
        }}
      >
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Active Claims
            </Typography>
            <Typography variant="h4" fontWeight={800}>
              {metrics.totalClaims}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Current organization
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center">
              <WarningAmber color="warning" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Needs Review
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={800}>
              {metrics.needsReview}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Draft / attention required
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleOutline color="success" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Ready to Submit
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={800}>
              {metrics.readyToSubmit}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Ready amount {money(metrics.readyAmount)}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center">
              <Schedule color="error" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Filing Risk
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={800}>
              {metrics.filingRisk}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Deadline expired or within 14 days
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Submitted / Finalized
            </Typography>
            <Typography variant="h4" fontWeight={800}>
              {metrics.submitted}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total billed {money(metrics.totalClaimed)}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", md: "center" }}
        >
          <TextField
            size="small"
            placeholder="Search patient, payer, member, policy, claim or authorization..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
            <InputLabel>Claim Status</InputLabel>
            <Select
              label="Claim Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="ALL">All statuses</MenuItem>
              <MenuItem value="DRAFT">Draft</MenuItem>
              <MenuItem value="NEEDS_REVIEW">Needs review</MenuItem>
              <MenuItem value="READY">Ready</MenuItem>
              <MenuItem value="SUBMITTED">Submitted</MenuItem>
              <MenuItem value="DENIED">Denied</MenuItem>
              <MenuItem value="PAID">Paid</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress size={34} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading pre-submission work queue...
          </Typography>
        </Paper>
      ) : data.items.length === 0 ? (
        <Alert severity="info">
          No claims match the selected search and status.
        </Alert>
      ) : (
        <Paper>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 1500 }}>
              <TableHead>
                <TableRow>
                  <TableCell><b>Priority / Claim</b></TableCell>
                  <TableCell><b>Form / Status</b></TableCell>
                  <TableCell><b>Timely Filing</b></TableCell>
                  <TableCell><b>Eligibility</b></TableCell>
                  <TableCell><b>Prior Auth</b></TableCell>
                  <TableCell><b>Readiness</b></TableCell>
                  <TableCell><b>Submission Risk</b></TableCell>
                  <TableCell><b>Payment Outlook</b></TableCell>
                  <TableCell><b>Next Action</b></TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {data.items.map((claim) => {
                  const readiness = claim.readiness || {};
                  const risk = claim.submissionRisk || {};
                  const auth = claim.priorAuthorization || {};
                  const nextAction = claim.nextActions?.[0] || null;

                  return (
                    <TableRow key={claim.id} hover>
                      <TableCell sx={{ minWidth: 235 }}>
                        <Stack spacing={0.7} alignItems="flex-start">
                          <Chip
                            size="small"
                            color={priorityColor(claim.priority)}
                            label={claim.priority || "LOW"}
                          />
                          <Typography fontWeight={700}>
                            {claim.patientName || "Unknown Patient"}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {claim.payerName || "Payer not recorded"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {claim.insurerClaimNo
                              ? `Claim ${claim.insurerClaimNo}`
                              : claim.memberId
                              ? `Member ${claim.memberId}`
                              : "No payer reference"}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 135 }}>
                        <Stack spacing={0.75} alignItems="flex-start">
                          <Chip
                            size="small"
                            variant="outlined"
                            label={
                              claim.claimForm === "INSTITUTIONAL"
                                ? "837I"
                                : claim.claimForm === "PROFESSIONAL"
                                ? "837P"
                                : "Form not set"
                            }
                          />
                          <Typography variant="body2">{claim.status}</Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 150 }}>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            size="small"
                            color={filingColor(claim.timelyFiling?.state)}
                            variant={
                              claim.timelyFiling?.state === "UNKNOWN"
                                ? "outlined"
                                : "filled"
                            }
                            label={filingLabel(claim.timelyFiling)}
                          />
                          {claim.timelyFiling?.deadline && (
                            <Typography variant="caption" color="text.secondary">
                              Deadline {date(claim.timelyFiling.deadline)}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 150 }}>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            size="small"
                            color={
                              claim.eligibility?.status === "VERIFIED"
                                ? "success"
                                : ["FAILED", "NEEDS_REVIEW"].includes(
                                    claim.eligibility?.status
                                  )
                                ? "error"
                                : "default"
                            }
                            variant="outlined"
                            label={eligibilityLabel(claim.eligibility?.status)}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {claim.eligibility?.checkedAt
                              ? `Checked ${date(claim.eligibility.checkedAt)}`
                              : "No current verification"}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 160 }}>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            size="small"
                            color={
                              ["APPROVED", "NOT_REQUIRED"].includes(auth.status)
                                ? "success"
                                : auth.status === "DENIED"
                                ? "error"
                                : "warning"
                            }
                            variant="outlined"
                            label={priorAuthLabel(auth)}
                          />
                          {auth.authorizationNo && (
                            <Typography variant="caption" color="text.secondary">
                              Auth {auth.authorizationNo}
                            </Typography>
                          )}
                          {auth.expired && (
                            <Typography variant="caption" color="error">
                              Authorization expired
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 175 }}>
                        {Number.isFinite(Number(readiness.score)) ? (
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography fontWeight={700}>
                                {readiness.score}/100
                              </Typography>
                              {readiness.state === "STALE" && (
                                <Chip size="small" color="warning" label="Stale" />
                              )}
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={Math.max(0, Math.min(100, Number(readiness.score)))}
                              color={readinessColor(Number(readiness.score))}
                              sx={{ height: 6, borderRadius: 4 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {readiness.blockerCount || 0} blockers •{" "}
                              {readiness.warningCount || 0} warnings
                            </Typography>
                          </Stack>
                        ) : (
                          <Chip
                            size="small"
                            variant="outlined"
                            label="Not evaluated"
                          />
                        )}
                      </TableCell>

                      <TableCell sx={{ minWidth: 180 }}>
                        {risk.level ? (
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Tooltip title={risk.methodology || ""}>
                              <Chip
                                size="small"
                                color={riskColor(risk.level)}
                                label={`${risk.level} • ${percentage(risk.score)}`}
                              />
                            </Tooltip>
                            {risk.factors?.[0] && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ maxWidth: 220 }}
                              >
                                {risk.factors[0]}
                              </Typography>
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Not evaluated
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell sx={{ minWidth: 190 }}>
                        <Typography fontWeight={700}>
                          {money(claim.paymentOutlook?.amount)}
                        </Typography>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              claim.paymentOutlook?.kind === "RECORDED"
                                ? "success"
                                : "default"
                            }
                            label={
                              claim.paymentOutlook?.kind === "RECORDED"
                                ? "Recorded"
                                : claim.paymentOutlook?.kind === "ESTIMATE"
                                ? "Estimate"
                                : "Unavailable"
                            }
                          />
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 0.5, maxWidth: 230 }}
                        >
                          {claim.paymentOutlook?.source}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ minWidth: 260 }}>
                        {nextAction ? (
                          <Stack spacing={0.75} alignItems="flex-start">
                            <Typography
                              variant="body2"
                              fontWeight={600}
                              color={
                                nextAction.severity === "error"
                                  ? "error.main"
                                  : nextAction.severity === "warning"
                                  ? "warning.dark"
                                  : "text.primary"
                              }
                            >
                              {nextAction.label}
                            </Typography>
                            {claim.nextActions.length > 1 && (
                              <Typography variant="caption" color="text.secondary">
                                +{claim.nextActions.length - 1} additional action
                                {claim.nextActions.length - 1 === 1 ? "" : "s"}
                              </Typography>
                            )}
                            <Button
                              size="small"
                              endIcon={<ArrowForward />}
                              onClick={() => openClaim(claim, true)}
                            >
                              Resolve
                            </Button>
                          </Stack>
                        ) : (
                          <Button
                            size="small"
                            variant="text"
                            endIcon={<ArrowForward />}
                            onClick={() => openClaim(claim)}
                          >
                            View claim
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={data.total}
            page={page}
            onPageChange={(_event, nextPage) => setPage(nextPage)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      )}

      <Alert severity="info" sx={{ mt: 2 }}>
        U.S. claim readiness should be interpreted alongside payer-specific coverage,
        medical-necessity, coding, enrollment, contract, and timely-filing requirements.
        The work queue does not replace payer policy or coding review.
      </Alert>
    </Box>
  );
}
