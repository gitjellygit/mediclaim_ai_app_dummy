import React from "react";
import {
  Alert,
  Box,
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
  TableRow,
  TextField,
  Typography,
  Button
} from "@mui/material";
import {
  Search as SearchIcon,
  Refresh,
  Visibility
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";

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

function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
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

function latestCheck(claim) {
  if (!Array.isArray(claim?.checks) || claim.checks.length === 0) return null;
  return claim.checks[0];
}

function projectedApproval(claim) {
  const approved = Number(claim?.approvedAmount);
  if (Number.isFinite(approved) && approved > 0) {
    return { amount: approved, source: "Recorded approval" };
  }

  const claimed = Number(claim?.amount);
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return { amount: null, source: "Awaiting valid claim amount" };
  }

  const deductions = Number(claim?.deductionAmount || 0);
  const copay = Number(claim?.copayAmount || 0);
  const projected = Math.max(0, claimed - deductions - copay);

  return {
    amount: projected,
    source:
      deductions > 0 || copay > 0
        ? "Claimed amount less recorded deductions/copay"
        : "No recorded deductions yet"
  };
}

export default function ApprovalIntelligence() {
  const navigate = useNavigate();
  const [claims, setClaims] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [riskFilter, setRiskFilter] = React.useState("ALL");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const baseClaims = await ClaimsApi.list();
      const list = Array.isArray(baseClaims) ? baseClaims : [];

      const detailed = await Promise.all(
        list.map(async (claim) => {
          try {
            return await ClaimsApi.get(claim.id);
          } catch {
            return claim;
          }
        })
      );

      setClaims(detailed);
    } catch (e) {
      setClaims([]);
      setError(e?.message || "Failed to load approval intelligence");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const enriched = React.useMemo(
    () =>
      claims.map((claim) => {
        const check = latestCheck(claim);
        const projection = projectedApproval(claim);
        const issues = Array.isArray(check?.issues) ? check.issues : [];
        const blockers = issues.filter((issue) => issue?.severity === "BLOCK");

        return {
          ...claim,
          latestCheck: check,
          projection,
          blockers
        };
      }),
    [claims]
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();

    return enriched.filter((claim) => {
      const check = claim.latestCheck;
      const risk = check?.riskLevel || "NOT_CHECKED";

      if (riskFilter !== "ALL" && risk !== riskFilter) return false;
      if (statusFilter !== "ALL" && claim.status !== statusFilter) return false;

      if (!q) return true;

      return [
        claim.patientName,
        claim.payerName,
        claim.policyNo,
        claim.memberId,
        claim.insurerClaimNo,
        claim.authorizationNo
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [enriched, search, riskFilter, statusFilter]);

  const metrics = React.useMemo(() => {
    const totalClaimed = enriched.reduce(
      (sum, claim) => sum + (Number(claim.amount) || 0),
      0
    );

    const projected = enriched.reduce(
      (sum, claim) => sum + (Number(claim.projection?.amount) || 0),
      0
    );

    const highRisk = enriched.filter(
      (claim) => claim.latestCheck?.riskLevel === "HIGH"
    ).length;

    const ready = enriched.filter(
      (claim) => claim.status === "READY" || claim.status === "SUBMITTED"
    ).length;

    return { totalClaimed, projected, highRisk, ready };
  }, [enriched]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Approval Intelligence
          </Typography>
          <Typography color="text.secondary">
            Review claim readiness, rejection risk, expected payable amount, and approval blockers.
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
            sm: "1fr 1fr",
            lg: "repeat(4, 1fr)"
          },
          gap: 2,
          mb: 3
        }}
      >
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Claims in Review
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {enriched.length}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Ready / Submitted
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {metrics.ready}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              High Risk
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {metrics.highRisk}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2">
              Projected Payable
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {money(metrics.projected)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Claimed: {money(metrics.totalClaimed)}
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
            placeholder="Search patient, payer, policy, member or claim number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Risk</InputLabel>
            <Select
              label="Risk"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              <MenuItem value="ALL">All risk</MenuItem>
              <MenuItem value="LOW">Low</MenuItem>
              <MenuItem value="MED">Medium</MenuItem>
              <MenuItem value="HIGH">High</MenuItem>
              <MenuItem value="NOT_CHECKED">Not checked</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="ALL">All status</MenuItem>
              <MenuItem value="DRAFT">Draft</MenuItem>
              <MenuItem value="READY">Ready</MenuItem>
              <MenuItem value="SUBMITTED">Submitted</MenuItem>
              <MenuItem value="PAID">Paid</MenuItem>
              <MenuItem value="REJECTED">Rejected</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress size={34} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading approval intelligence...
          </Typography>
        </Paper>
      ) : filtered.length === 0 ? (
        <Alert severity="info">
          No claims match the selected filters.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><b>Patient / Payer</b></TableCell>
                <TableCell><b>Claimed</b></TableCell>
                <TableCell><b>Projected Payable</b></TableCell>
                <TableCell><b>Readiness</b></TableCell>
                <TableCell><b>Rejection Risk</b></TableCell>
                <TableCell><b>Blockers</b></TableCell>
                <TableCell><b>Documents</b></TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {filtered.map((claim) => {
                const check = claim.latestCheck;
                const readiness = Number(check?.score);
                const riskLevel = check?.riskLevel;

                return (
                  <TableRow key={claim.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>
                        {claim.patientName || "Unknown Patient"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {claim.payerName || "—"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {claim.policyNo ? `Policy ${claim.policyNo}` : "Policy not provided"}
                      </Typography>
                    </TableCell>

                    <TableCell>{money(claim.amount)}</TableCell>

                    <TableCell>
                      <Typography fontWeight={600}>
                        {money(claim.projection.amount)}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", maxWidth: 190 }}
                      >
                        {claim.projection.source}
                      </Typography>
                    </TableCell>

                    <TableCell sx={{ minWidth: 150 }}>
                      {Number.isFinite(readiness) ? (
                        <>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="body2" fontWeight={600}>
                              {readiness}/100
                            </Typography>
                            <Chip
                              size="small"
                              label={claim.status || "DRAFT"}
                              color={readinessColor(readiness)}
                              variant="outlined"
                            />
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={Math.max(0, Math.min(100, readiness))}
                            sx={{ mt: 1, height: 6, borderRadius: 3 }}
                          />
                        </>
                      ) : (
                        <Chip size="small" label="AI check not run" variant="outlined" />
                      )}
                    </TableCell>

                    <TableCell>
                      {riskLevel ? (
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            size="small"
                            label={riskLevel}
                            color={riskColor(riskLevel)}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {percent(check?.riskScore)}
                          </Typography>
                        </Stack>
                      ) : (
                        <Chip size="small" label="Not checked" variant="outlined" />
                      )}
                    </TableCell>

                    <TableCell>
                      {claim.blockers.length > 0 ? (
                        <Stack spacing={0.5}>
                          {claim.blockers.slice(0, 2).map((issue, index) => (
                            <Chip
                              key={index}
                              size="small"
                              color="error"
                              variant="outlined"
                              label={issue.message || "Blocking issue"}
                            />
                          ))}
                          {claim.blockers.length > 2 && (
                            <Typography variant="caption" color="text.secondary">
                              +{claim.blockers.length - 2} more
                            </Typography>
                          )}
                        </Stack>
                      ) : check ? (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label="No blockers"
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Run AI check
                        </Typography>
                      )}
                    </TableCell>

                    <TableCell>
                      <Chip
                        size="small"
                        label={claim.documents?.length || 0}
                        variant="outlined"
                      />
                    </TableCell>

                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<Visibility />}
                        onClick={() => navigate(`/claims/${claim.id}`)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Alert severity="info" sx={{ mt: 2 }}>
        Projected payable is based on recorded claim values, deductions and copay. It is not an insurer guarantee.
        Rejection risk and readiness come from the latest AI check for each claim.
      </Alert>
    </Box>
  );
}
