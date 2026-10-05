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
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DescriptionIcon from "@mui/icons-material/Description";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ScienceIcon from "@mui/icons-material/Science";
import { useLocation, useNavigate } from "react-router-dom";
import { MedicalConsistencyApi } from "../../api/medicalConsistency.js";

function scoreColor(score) {
  if (score < 60) return "error";
  if (score < 85) return "warning";
  return "success";
}

function statusColor(status) {
  if (status === "BLOCKED") return "error";
  if (status === "NEEDS_REVIEW") return "warning";
  return "success";
}

function human(value) {
  return String(value || "—").replaceAll("_", " ");
}

function MetricCard({ title, value, subtitle, icon, color = "primary" }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ mt: 0.5 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box sx={{ color: `${color}.main` }}>{icon}</Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function MedicalConsistency() {
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(async (search = query) => {
    setLoading(true);
    setError("");
    try {
      const result = await MedicalConsistencyApi.summary(search, 50);
      setData(result);
    } catch (e) {
      setError(e.message || "Unable to load medical consistency analysis");
    } finally {
      setLoading(false);
    }
  }, [query]);

  React.useEffect(() => {
    load("");
  }, []);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length === 0 || query.trim().length >= 2) {
        load(query);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  async function openAnalysis(item) {
    setSelected({ claim: item.claim, analysis: item.analysis });
    setDetailLoading(true);
    try {
      const detail = await MedicalConsistencyApi.claim(item.claim.id);
      setSelected(detail);
    } catch (e) {
      setError(e.message || "Unable to load claim analysis");
    } finally {
      setDetailLoading(false);
    }
  }

  function openClaim(claimId, finding = null) {
    const params = new URLSearchParams();

    if (finding) {
      const fields = Array.isArray(finding.fields)
        ? finding.fields.filter(Boolean)
        : [];

      if (finding.fixTarget === "documents" || fields.includes("documents")) {
        params.set("section", "documents");
        params.set("focus", "documents");
      } else {
        params.set("edit", "1");
        if (fields.length) params.set("focus", fields.join(","));
      }

      if (finding.title) params.set("issue", finding.title);
    }

    const queryString = params.toString();
    navigate(`/claims/${claimId}${queryString ? `?${queryString}` : ""}`, {
      state: {
        from: location.pathname + location.search,
        backLabel: "Back to Medical Consistency",
        issueTitle: finding?.title || null
      }
    });
  }

  const metrics = data?.metrics || {
    total: 0,
    consistent: 0,
    needsReview: 0,
    blocked: 0,
    averageScore: 0
  };

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
          <Stack direction="row" spacing={1} alignItems="center">
            <ScienceIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Medical Consistency
            </Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Find internal clinical, encounter, utilization, and document inconsistencies before submission.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => load(query)}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        Decision support only. This module checks internal consistency; it does not determine medical necessity,
        coding correctness, or payer coverage.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            xl: "repeat(5, minmax(0, 1fr))"
          },
          gap: 2,
          mb: 3
        }}
      >
        <MetricCard
          title="Claims Reviewed"
          value={metrics.total}
          icon={<FactCheckIcon fontSize="large" />}
        />
        <MetricCard
          title="Consistent"
          value={metrics.consistent}
          color="success"
          icon={<CheckCircleIcon fontSize="large" />}
        />
        <MetricCard
          title="Needs Review"
          value={metrics.needsReview}
          color="warning"
          icon={<WarningAmberIcon fontSize="large" />}
        />
        <MetricCard
          title="Blocked"
          value={metrics.blocked}
          color="error"
          icon={<ErrorOutlineIcon fontSize="large" />}
        />
        <MetricCard
          title="Average Score"
          value={`${metrics.averageScore}%`}
          subtitle="Rule-based consistency"
          color={scoreColor(metrics.averageScore)}
          icon={<ScienceIcon fontSize="large" />}
        />
      </Box>

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search patient, payer, policy, member ID, or claim ID"
          fullWidth
          size="small"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            )
          }}
        />
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Checking claim consistency...
          </Typography>
        </Stack>
      ) : !data?.items?.length ? (
        <Paper sx={{ p: 5, textAlign: "center" }}>
          <Typography variant="h6">No claims found</Typography>
          <Typography color="text.secondary">
            Try a different search or create a claim first.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {data.items.map((item) => {
            const { claim, analysis } = item;
            return (
              <Paper
                key={claim.id}
                data-testid="medical-claim-row"
                data-claim-name={claim.patientName}
                variant="outlined"
                sx={{
                  p: 2,
                  cursor: "pointer",
                  transition: "all .15s ease",
                  "&:hover": {
                    boxShadow: 2,
                    transform: "translateY(-1px)"
                  }
                }}
                onClick={() => openAnalysis(item)}
              >
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  alignItems={{ xs: "stretch", md: "center" }}
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                      <Typography variant="subtitle1" fontWeight={800}>
                        {claim.patientName}
                      </Typography>
                      <Chip
                        size="small"
                        color={statusColor(analysis.status)}
                        label={human(analysis.status)}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {claim.payerName} • {claim.policyNo || "No policy"} • {claim.diagnosisText || "Diagnosis not recorded"}
                    </Typography>
                  </Box>

                  <Box sx={{ width: { xs: "100%", md: 220 } }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        Consistency
                      </Typography>
                      <Typography variant="body2" fontWeight={800}>
                        {analysis.score}%
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={analysis.score}
                      color={scoreColor(analysis.score)}
                      sx={{ height: 8, borderRadius: 99, mt: 0.5 }}
                    />
                  </Box>

                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {analysis.blockingIssues > 0 && (
                      <Chip size="small" color="error" label={`${analysis.blockingIssues} blocking`} />
                    )}
                    {analysis.warnings > 0 && (
                      <Chip size="small" color="warning" label={`${analysis.warnings} warning(s)`} />
                    )}
                    {analysis.issues.length === 0 && (
                      <Chip size="small" color="success" label="No issues" />
                    )}
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{
          "data-testid": "medical-consistency-drawer",
          sx: {
            width: { xs: "100%", sm: 560 },
            p: { xs: 2, sm: 3 }
          }
        }}
      >
        {selected && (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h5" fontWeight={800}>
                Clinical Consistency Review
              </Typography>
              <Typography color="text.secondary">
                {selected.claim.patientName} • {selected.claim.payerName}
              </Typography>
            </Box>

            {detailLoading ? (
              <Stack alignItems="center" sx={{ py: 5 }}>
                <CircularProgress />
              </Stack>
            ) : (
              <>
                <Card variant="outlined">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Consistency Score
                        </Typography>
                        <Typography variant="h3" fontWeight={900}>
                          {selected.analysis.score}%
                        </Typography>
                      </Box>
                      <Chip
                        color={statusColor(selected.analysis.status)}
                        label={human(selected.analysis.status)}
                      />
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={selected.analysis.score}
                      color={scoreColor(selected.analysis.score)}
                      sx={{ height: 10, borderRadius: 99, mt: 2 }}
                    />
                  </CardContent>
                </Card>

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    icon={<ScienceIcon />}
                    label={selected.analysis.engine.label}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    color="error"
                    label={`${selected.analysis.blockingIssues} blocking`}
                  />
                  <Chip
                    size="small"
                    color="warning"
                    label={`${selected.analysis.warnings} warning(s)`}
                  />
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={`${selected.analysis.passedChecks} checks passed`}
                  />
                </Stack>

                <Divider />

                <Box>
                  <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>
                    Findings
                  </Typography>

                  {!selected.analysis.issues.length ? (
                    <Alert severity="success">
                      No internal consistency issues were detected by the current rule set.
                    </Alert>
                  ) : (
                    <Stack spacing={1.25}>
                      {selected.analysis.issues.map((finding, index) => (
                        <Paper
                          key={`${finding.title}-${index}`}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderColor:
                              finding.severity === "BLOCK"
                                ? "error.light"
                                : "warning.light"
                          }}
                        >
                          <Stack spacing={1}>
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              alignItems="flex-start"
                              spacing={1}
                            >
                              <Box>
                                <Typography variant="subtitle2" fontWeight={800}>
                                  {finding.title}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {finding.message}
                                </Typography>
                              </Box>
                              <Chip
                                size="small"
                                color={finding.severity === "BLOCK" ? "error" : "warning"}
                                label={finding.severity}
                              />
                            </Stack>

                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                              <Chip size="small" variant="outlined" label={human(finding.category)} />
                              {(finding.fields || []).map((field) => (
                                <Chip key={field} size="small" variant="outlined" label={human(field)} />
                              ))}
                            </Stack>

                            {finding.evidence?.length > 0 && (
                              <Tooltip title="Values found across uploaded documents">
                                <Chip
                                  size="small"
                                  icon={<DescriptionIcon />}
                                  label={`${finding.evidence.length} conflicting values`}
                                  variant="outlined"
                                />
                              </Tooltip>
                            )}

                            <Button
                              size="small"
                              variant="contained"
                              color={finding.severity === "BLOCK" ? "error" : "warning"}
                              onClick={() => openClaim(selected.claim.id, finding)}
                            >
                              Fix in Claim
                            </Button>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Box>

                {selected.analysis.checks?.length > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
                        Passed Checks
                      </Typography>
                      <Stack spacing={0.75}>
                        {selected.analysis.checks.map((check) => (
                          <Stack
                            key={check.key}
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <CheckCircleIcon color="success" fontSize="small" />
                            <Typography variant="body2">{check.label}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  </>
                )}

                <Alert severity="info">{selected.analysis.disclaimer}</Alert>

                <Button
                  variant="outlined"
                  endIcon={<OpenInNewIcon />}
                  onClick={() => openClaim(selected.claim.id)}
                >
                  Open Claim Detail
                </Button>
              </>
            )}
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
