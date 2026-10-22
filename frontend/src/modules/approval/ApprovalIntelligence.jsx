import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  InputAdornment,
  LinearProgress,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  ArrowForward,
  Check,
  CheckCircleOutline,
  Refresh,
  Schedule,
  Search as SearchIcon,
  Tune,
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
    return `Expired ${Math.abs(filing.daysRemaining)} D ago`;
  }
  if (filing.daysRemaining === 0) return "Due today";
  return `${filing.daysRemaining} D remaining`;
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

function isPostSubmission(claim) {
  return ["SUBMITTING", "SUBMITTED", "DENIED", "PAID"].includes(claim?.status);
}

function sortableHeader(label, field, sort, direction, onSort, help = "") {
  const content = (
    <TableSortLabel
      hideSortIcon={false}
      sx={{
        "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" },
        "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" }
      }}
      active={sort === field}
      direction={sort === field ? direction : "asc"}
      onClick={() => onSort(field)}
    >
      <b>{label}</b>
    </TableSortLabel>
  );

  return help ? (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {content}
      <Tooltip title={help} arrow>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ cursor: "help" }}>
          ⓘ
        </Typography>
      </Tooltip>
    </Stack>
  ) : content;
}

function codingReviewPresentation(claim) {
  const verified = Number(claim?.coding?.verifiedServiceLines || 0);
  const pending = Number(claim?.coding?.pendingSuggestions || 0);

  if (claim?.status === "PAID") {
    return {
      label: "Finalized",
      color: "success",
      detail: verified > 0
        ? `${verified} verified line${verified === 1 ? "" : "s"} at submission`
        : "Coding snapshot retained in claim history"
    };
  }

  if (claim?.status === "DENIED") {
    return {
      label: pending > 0 ? "Review for denial" : "Submitted coding",
      color: pending > 0 ? "warning" : "default",
      detail: pending > 0
        ? "Historical coding suggestions may be reviewed during denial recovery"
        : verified > 0
        ? `${verified} verified line${verified === 1 ? "" : "s"} at submission`
        : "Coding snapshot retained in claim history"
    };
  }

  if (claim?.status === "SUBMITTING") {
    return {
      label: "Submission locked",
      color: "warning",
      detail: "Coding is frozen while payer submission is in progress or awaiting reconciliation"
    };
  }

  if (claim?.status === "SUBMITTED") {
    return {
      label: verified > 0
        ? `${verified} verified line${verified === 1 ? "" : "s"}`
        : "Submitted coding",
      color: verified > 0 ? "success" : "default",
      detail: "Submitted coding snapshot"
    };
  }

  return {
    label:
      pending > 0
        ? `${pending} suggestion${pending === 1 ? "" : "s"} pending`
        : verified > 0
        ? `${verified} verified line${verified === 1 ? "" : "s"}`
        : "No verified lines",
    color: pending > 0 ? "warning" : verified > 0 ? "success" : "default",
    detail: "Official NCCI/MUE and payer edits require a maintained coding-edit source."
  };
}

function paymentKindLabel(kind) {
  if (kind === "PAID") return "Paid";
  if (kind === "AT_RISK") return "Revenue at risk";
  if (kind === "EXPECTED") return "Payer approved";
  if (kind === "ESTIMATE") return "Est. reimbursement";
  return "Unavailable";
}

function paymentKindColor(kind) {
  if (kind === "PAID") return "success";
  if (kind === "AT_RISK") return "error";
  if (kind === "EXPECTED") return "info";
  return "default";
}

function actionButtonLabel(action) {
  if (action?.code === "RUN_READINESS") return "Run Readiness Check";
  if (action?.code === "REFRESH_READINESS") return "Refresh Readiness";
  if (action?.code === "READY_TO_SUBMIT") return "Review & Submit";
  if (action?.code === "VERIFY_ELIGIBILITY") return "Check Eligibility";
  if (action?.code === "RESOLVE_PRIOR_AUTH") return "Review Prior Auth";
  if (String(action?.code || "").startsWith("TIMELY_FILING_")) {
    return "Resolve Filing Risk";
  }
  if (String(action?.code || "").startsWith("BLOCKER_")) return "Resolve Issue";
  return "Resolve";
}

function lifecycleAction(claim) {
  if (claim?.status === "DENIED") {
    return {
      code: "REVIEW_DENIAL",
      label: "Review denial and recovery options",
      buttonLabel: "Review Denial",
      path: `/journey?claimId=${claim.id}&stage=claim-status&focus=status-action`
    };
  }

  if (claim?.status === "PAID") {
    return {
      code: "VIEW_REMITTANCE",
      label: "Review payer remittance and payment details",
      buttonLabel: "View Remittance",
      path: `/journey?claimId=${claim.id}&stage=remittance&focus=remittance-action`
    };
  }

  if (claim?.status === "SUBMITTED") {
    return {
      code: "TRACK_CLAIM",
      label: "Track payer claim status",
      buttonLabel: "Track Claim",
      path: `/journey?claimId=${claim.id}&stage=claim-status&focus=status-action`
    };
  }

  return null;
}

function nextActionPath(claim) {
  const first = claim?.nextActions?.[0];
  const target = String(first?.target || "").toLowerCase();
  const code = String(first?.code || "");

  if (target === "eligibility") {
    return `/journey?claimId=${claim.id}&stage=eligibility&focus=eligibility-action`;
  }
  if (target === "prior-auth" || target === "prior_auth") {
    return `/journey?claimId=${claim.id}&stage=prior-auth&focus=prior-auth-action`;
  }
  if (target === "journey") {
    return `/claims/${claim.id}?section=readiness&focus=submit-claim-action`;
  }
  if (target === "documents") {
    return `/claims/${claim.id}?section=documents&focus=documents`;
  }
  if (target === "readiness") {
    return `/claims/${claim.id}?section=readiness&focus=readiness-action`;
  }
  if (code.startsWith("TIMELY_FILING_")) {
    return `/claims/${claim.id}?edit=1&focus=timelyFilingDeadline`;
  }
  if (code.startsWith("BLOCKER_") && first?.field) {
    return `/claims/${claim.id}?edit=1&focus=${encodeURIComponent(first.field)}`;
  }
  if (code.startsWith("BLOCKER_") && target === "servicelines") {
    return `/claims/${claim.id}?edit=1&focus=cptHcpcsCode`;
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
    methodology: null,
    submissionAlert: null
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [work, setWork] = React.useState("ALL");
  const [filing, setFiling] = React.useState("ALL");
  const [filterAnchor, setFilterAnchor] = React.useState(null);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [sort, setSort] = React.useState("priority");
  const [direction, setDirection] = React.useState("desc");

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
        status,
        work,
        filing,
        sort,
        direction
      });

      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        total: Number(result?.total || 0),
        metrics: result?.metrics || null,
        methodology: result?.methodology || null,
        submissionAlert: result?.submissionAlert || null
      });
    } catch (e) {
      setData((current) => ({ ...current, items: [], total: 0 }));
      setError(e?.message || "Claim Work Queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, query, status, work, filing, sort, direction]);

  React.useEffect(() => {
    load();
  }, [load]);

  function handleSort(field) {
    setPage(0);
    if (sort === field) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(field);
    setDirection(
      ["priority", "coding", "readiness", "risk", "payment"].includes(field)
        ? "desc"
        : "asc"
    );
  }

  const metrics = data.metrics || {
    totalClaims: 0,
    needsReview: 0,
    readyToSubmit: 0,
    submitting: 0,
    submitted: 0,
    staleSubmitting: 0,
    filingRisk: 0,
    totalClaimed: 0,
    readyAmount: 0
  };

  function openClaim(claim, useNextAction = false, explicitPath = null) {
    navigate(
      explicitPath ||
        (useNextAction ? nextActionPath(claim) : `/claims/${claim.id}`),
      {
        state: {
          from: location.pathname + location.search,
          backLabel: "Back to Claim Work Queue"
        }
      }
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
            Claim Work Queue
          </Typography>
          <Typography color="text.secondary">
            Prioritized billing work queue for claim readiness, eligibility, prior authorization,
            timely filing, coding, and submission follow-up.
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

      {data.submissionAlert && (
        <Alert severity="warning" sx={{ mb: 3 }} data-testid="stale-submission-alert">
          {data.submissionAlert.message} Stale submissions: {data.submissionAlert.count}.
          Use the admin submission reconciliation action before retrying or editing those claims.
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
              Submitting / Submitted / Finalized
            </Typography>
            <Typography variant="h4" fontWeight={800}>
              {metrics.submitted}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {metrics.submitting} currently in flight · Total billed {money(metrics.totalClaimed)}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Paper sx={{ p: 1.5, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.25}
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

          <Button
            variant={(status !== "ALL" || work !== "ALL" || filing !== "ALL") ? "contained" : "outlined"}
            startIcon={<Tune />}
            onClick={(event) => setFilterAnchor(event.currentTarget)}
            sx={{ whiteSpace: "nowrap" }}
            data-testid="claim-work-queue-filters"
          >
            Smart Filters
            {(status !== "ALL" || work !== "ALL" || filing !== "ALL")
              ? ` (${[status !== "ALL", work !== "ALL", filing !== "ALL"].filter(Boolean).length})`
              : ""}
          </Button>

          {(status !== "ALL" || work !== "ALL" || filing !== "ALL") && (
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {work !== "ALL" && (
                <Chip
                  size="small"
                  label={
                    {
                      NEEDS_ACTION: "Needs action",
                      READY: "Ready to submit",
                      ELIGIBILITY: "Eligibility",
                      PRIOR_AUTH: "Prior auth"
                    }[work] || work
                  }
                  onDelete={() => {
                    setWork("ALL");
                    setPage(0);
                  }}
                />
              )}
              {filing !== "ALL" && (
                <Chip
                  size="small"
                  label={
                    {
                      EXPIRED: "Filing expired",
                      DUE_7: "Filing ≤ 7 days",
                      DUE_30: "Filing ≤ 30 days"
                    }[filing] || filing
                  }
                  onDelete={() => {
                    setFiling("ALL");
                    setPage(0);
                  }}
                />
              )}
              {status !== "ALL" && (
                <Chip
                  size="small"
                  label={`Status: ${status.replaceAll("_", " ")}`}
                  onDelete={() => {
                    setStatus("ALL");
                    setPage(0);
                  }}
                />
              )}
            </Stack>
          )}
        </Stack>

        <Menu
          anchorEl={filterAnchor}
          open={Boolean(filterAnchor)}
          onClose={() => setFilterAnchor(null)}
          MenuListProps={{ dense: true, sx: { minWidth: 290, py: 0.5 } }}
        >
          <ListSubheader disableSticky>Work type</ListSubheader>
          {[
            ["ALL", "All work"],
            ["NEEDS_ACTION", "Needs action"],
            ["READY", "Ready to submit"],
            ["ELIGIBILITY", "Eligibility issues"],
            ["PRIOR_AUTH", "Prior authorization issues"]
          ].map(([value, label]) => (
            <MenuItem
              key={value}
              onClick={() => {
                setWork(value);
                setPage(0);
              }}
            >
              <Box sx={{ width: 28 }}>{work === value ? <Check fontSize="small" /> : null}</Box>
              {label}
            </MenuItem>
          ))}

          <ListSubheader disableSticky>Timely filing</ListSubheader>
          {[
            ["ALL", "Any filing window"],
            ["EXPIRED", "Expired"],
            ["DUE_7", "Due within 7 days"],
            ["DUE_30", "Due within 30 days"]
          ].map(([value, label]) => (
            <MenuItem
              key={value}
              onClick={() => {
                setFiling(value);
                setPage(0);
              }}
            >
              <Box sx={{ width: 28 }}>{filing === value ? <Check fontSize="small" /> : null}</Box>
              {label}
            </MenuItem>
          ))}

          <ListSubheader disableSticky>Claim status</ListSubheader>
          {[
            ["ALL", "All statuses"],
            ["DRAFT", "Draft"],
            ["NEEDS_REVIEW", "Needs review"],
            ["READY", "Ready"],
            ["SUBMITTING", "Submitting"],
            ["SUBMITTED", "Submitted"],
            ["DENIED", "Denied"],
            ["PAID", "Paid"]
          ].map(([value, label]) => (
            <MenuItem
              key={value}
              onClick={() => {
                setStatus(value);
                setPage(0);
              }}
            >
              <Box sx={{ width: 28 }}>{status === value ? <Check fontSize="small" /> : null}</Box>
              {label}
            </MenuItem>
          ))}

          {(status !== "ALL" || work !== "ALL" || filing !== "ALL") && (
            <MenuItem
              onClick={() => {
                setStatus("ALL");
                setWork("ALL");
                setFiling("ALL");
                setPage(0);
                setFilterAnchor(null);
              }}
              sx={{ mt: 0.5, fontWeight: 700 }}
            >
              Clear all filters
            </MenuItem>
          )}
        </Menu>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress size={34} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading Claim Work Queue...
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
                  <TableCell>{sortableHeader("Priority / Claim", "priority", sort, direction, handleSort)}</TableCell>
                  <TableCell>{sortableHeader("Form / Status", "formStatus", sort, direction, handleSort)}</TableCell>
                  <TableCell>{sortableHeader("Timely Filing", "timelyFiling", sort, direction, handleSort, "Deadline urgency before submission; finalized claims show when they were filed instead of a remaining-day countdown.")}</TableCell>
                  <TableCell>{sortableHeader("Eligibility", "eligibility", sort, direction, handleSort, "Coverage verification used during claim preparation. On submitted or finalized claims this is historical context.")}</TableCell>
                  <TableCell>{sortableHeader("Prior Auth", "priorAuth", sort, direction, handleSort, "Prior-authorization state used during claim preparation. On submitted or finalized claims this is historical context.")}</TableCell>
                  <TableCell>{sortableHeader("Coding Review", "coding", sort, direction, handleSort, "Actionable coding work before submission; after submission this becomes a historical coding snapshot.")}</TableCell>
                  <TableCell>{sortableHeader("Readiness", "readiness", sort, direction, handleSort, "Pre-submission validation score. After submission, it is shown only as the historical score at submission.")}</TableCell>
                  <TableCell>{sortableHeader("Pre-Submit Risk", "risk", sort, direction, handleSort, "Rules-based pre-submission risk signal. It is not a payer approval or denial probability and is not actionable after submission.")}</TableCell>
                  <TableCell>{sortableHeader("Payment Outlook", "payment", sort, direction, handleSort, "Estimated reimbursement before adjudication, payer-approved amount during adjudication, revenue at risk after denial, or actual payer payment after remittance.")}</TableCell>
                  <TableCell><b>Next Action</b></TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {data.items.map((claim) => {
                  const readiness = claim.readiness || {};
                  const risk = claim.submissionRisk || {};
                  const auth = claim.priorAuthorization || {};
                  const nextAction = claim.nextActions?.[0] || null;
                  const terminalAction = lifecycleAction(claim);
                  const primaryAction = terminalAction || nextAction;
                  const postSubmission = isPostSubmission(claim);
                  const codingDisplay = codingReviewPresentation(claim);

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
                            color={postSubmission ? "default" : filingColor(claim.timelyFiling?.state)}
                            variant={
                              postSubmission || claim.timelyFiling?.state === "UNKNOWN"
                                ? "outlined"
                                : "filled"
                            }
                            label={
                              postSubmission
                                ? claim.claimSubmissionDate
                                  ? `Filed ${date(claim.claimSubmissionDate)}`
                                  : "Filed"
                                : filingLabel(claim.timelyFiling)
                            }
                          />
                          {!postSubmission && claim.timelyFiling?.deadline && (
                            <Typography variant="caption" color="text.secondary">
                              Deadline {date(claim.timelyFiling.deadline)}
                            </Typography>
                          )}
                          {postSubmission && (
                            <Typography variant="caption" color="text.secondary">
                              Filing window is historical after submission
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
                            {postSubmission
                              ? claim.eligibility?.checkedAt
                                ? `Historical • checked ${date(claim.eligibility.checkedAt)}`
                                : "Historical eligibility status"
                              : claim.eligibility?.checkedAt
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
                          {auth.expired && !postSubmission && (
                            <Typography variant="caption" color="error">
                              Authorization expired
                            </Typography>
                          )}
                          {postSubmission && (
                            <Typography variant="caption" color="text.secondary">
                              Historical authorization status
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 160 }}>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            size="small"
                            variant="outlined"
                            color={codingDisplay.color}
                            label={codingDisplay.label}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {codingDisplay.detail}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell sx={{ minWidth: 175 }}>
                        {Number.isFinite(Number(readiness.score)) ? (
                          postSubmission ? (
                            <Stack spacing={0.5} alignItems="flex-start">
                              <Typography fontWeight={700}>{readiness.score}/100</Typography>
                              <Chip size="small" variant="outlined" label="At submission" />
                              <Typography variant="caption" color="text.secondary">
                                Historical pre-submit snapshot
                              </Typography>
                            </Stack>
                          ) : (
                            <Stack spacing={0.75}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Typography fontWeight={700}>{readiness.score}/100</Typography>
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
                          )
                        ) : (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={postSubmission ? "No submission snapshot" : "Not evaluated"}
                          />
                        )}
                      </TableCell>

                      <TableCell sx={{ minWidth: 180 }}>
                        {postSubmission ? (
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Typography variant="body2" color="text.secondary">—</Typography>
                            <Typography variant="caption" color="text.secondary">
                              Pre-submit only
                            </Typography>
                          </Stack>
                        ) : risk.level ? (
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Tooltip title={risk.methodology || ""}>
                              <Chip size="small" color={riskColor(risk.level)} label={risk.level} />
                            </Tooltip>
                            <Typography variant="caption" color="text.secondary">
                              {Number.isFinite(Number(risk.score))
                                ? `${Math.round(Number(risk.score) * 100)}/100 risk score`
                                : "Rules-based risk signal"}
                            </Typography>
                            {risk.factors?.[0] && (
                              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 220 }}>
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
                            color={paymentKindColor(claim.paymentOutlook?.kind)}
                            label={paymentKindLabel(claim.paymentOutlook?.kind)}
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

                      <TableCell sx={{ minWidth: 280 }}>
                        <Stack spacing={0.75} alignItems="flex-start">
                          {primaryAction && (
                            <>
                              <Typography
                                variant="body2"
                                fontWeight={600}
                                color={
                                  primaryAction.severity === "error"
                                    ? "error.main"
                                    : primaryAction.severity === "warning"
                                    ? "warning.dark"
                                    : "text.primary"
                                }
                              >
                                {primaryAction.label}
                              </Typography>

                              {!terminalAction && claim.nextActions.length > 1 && (
                                <Typography variant="caption" color="text.secondary">
                                  +{claim.nextActions.length - 1} additional action
                                  {claim.nextActions.length - 1 === 1 ? "" : "s"}
                                </Typography>
                              )}

                              <Button
                                size="small"
                                variant="contained"
                                endIcon={<ArrowForward />}
                                onClick={() =>
                                  terminalAction
                                    ? openClaim(claim, false, terminalAction.path)
                                    : openClaim(claim, true)
                                }
                              >
                                {terminalAction?.buttonLabel ||
                                  actionButtonLabel(nextAction)}
                              </Button>
                            </>
                          )}

                          <Button
                            size="small"
                            variant="text"
                            onClick={() => openClaim(claim)}
                          >
                            View Claim
                          </Button>
                        </Stack>
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
            rowsPerPageOptions={[10]}
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
