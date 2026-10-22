import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography
} from "@mui/material";
import {
  AccountBalanceWallet,
  ArrowForward,
  Assessment,
  CheckCircleOutline,
  Refresh,
  Schedule,
  TrendingDown,
  TrendingUp,
  WarningAmber
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { AnalyticsApi } from "../../api/analytics.js";
import { formatUSD } from "../../utils/currency.js";

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function DonutChart({ items, centerLabel, centerValue }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value || 0)), 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, gap: 1.5, alignItems: "center" }}>
      <Box sx={{ position: "relative", width: 170, height: 170, mx: "auto" }}>
        <Box component="svg" viewBox="0 0 120 120" sx={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#E7EDF2" strokeWidth="16" />
          {total > 0 && items.map((item) => {
            const value = Math.max(0, Number(item.value || 0));
            const length = (value / total) * circumference;
            const segment = (
              <circle
                key={item.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth="16"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += length;
            return segment;
          })}
        </Box>
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
          <Box>
            <Typography variant="h5" fontWeight={850} lineHeight={1}>{centerValue}</Typography>
            <Typography variant="caption" color="text.secondary">{centerLabel}</Typography>
          </Box>
        </Box>
      </Box>

      <Stack spacing={0.8}>
        {items.map((item) => (
          <Stack key={item.label} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: item.color, flexShrink: 0 }} />
              <Typography variant="body2" noWrap>{item.label}</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={750}>{item.value}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function ColumnChart({ items, valueKey = "amount", formatter = formatUSD }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));
  return (
    <Box sx={{ height: 190, display: "flex", alignItems: "flex-end", gap: 1, pt: 1 }}>
      {items.map((item) => {
        const value = Number(item[valueKey] || 0);
        const height = Math.max(6, (value / max) * 138);
        return (
          <Box key={item.label} sx={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <Tooltip title={`${item.label}: ${formatter(value)}`}>
              <Box
                sx={{
                  height,
                  mx: "auto",
                  width: "min(34px, 72%)",
                  borderRadius: "5px 5px 2px 2px",
                  background: "linear-gradient(180deg, #2E7C86 0%, #173B57 100%)",
                  boxShadow: "0 5px 12px rgba(23,59,87,0.12)"
                }}
              />
            </Tooltip>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </Typography>
            <Typography variant="caption" fontWeight={700}>{formatter(value)}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function MetricCard({ title, value, subtitle, icon, onClick, testId }) {
  const body = (
    <CardContent>
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
        <Box>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="h4" fontWeight={800} sx={{ mt: 0.5 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>
        {icon}
      </Stack>
    </CardContent>
  );

  return (
    <Card data-testid={testId} sx={{ height: "100%" }}>
      {onClick ? (
        <CardActionArea onClick={onClick} sx={{ height: "100%" }}>
          {body}
        </CardActionArea>
      ) : body}
    </Card>
  );
}

function BarList({ items, labelKey = "label", valueKey = "amount", formatter = formatUSD }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));
  return (
    <Stack spacing={1.5}>
      {items.map((item) => (
        <Box key={item[labelKey]}>
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="body2" fontWeight={650}>
              {item[labelKey]}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatter(item[valueKey])}
            </Typography>
          </Stack>
          <Box
            sx={{
              mt: 0.6,
              height: 8,
              borderRadius: 999,
              bgcolor: "action.hover",
              overflow: "hidden"
            }}
          >
            <Box
              sx={{
                height: "100%",
                width: `${Math.max(3, (Number(item[valueKey] || 0) / max) * 100)}%`,
                bgcolor: "primary.main",
                borderRadius: 999
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function TrendPanel({ trend }) {
  const max = Math.max(
    1,
    ...trend.flatMap((item) => [Number(item.billed || 0), Number(item.paid || 0)])
  );

  return (
    <Stack spacing={1.4}>
      {trend.map((item) => (
        <Box key={item.label}>
          <Stack direction="row" justifyContent="space-between" spacing={1}>
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.submitted} submitted · {item.denied} denied
            </Typography>
          </Stack>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            <Tooltip title={`Billed ${formatUSD(item.billed)}`}>
              <Box sx={{ height: 7, bgcolor: "action.hover", borderRadius: 999, overflow: "hidden" }}>
                <Box
                  sx={{
                    height: "100%",
                    width: `${Math.max(2, (Number(item.billed || 0) / max) * 100)}%`,
                    bgcolor: "primary.main"
                  }}
                />
              </Box>
            </Tooltip>
            <Tooltip title={`Paid ${formatUSD(item.paid)}`}>
              <Box sx={{ height: 7, bgcolor: "action.hover", borderRadius: 999, overflow: "hidden" }}>
                <Box
                  sx={{
                    height: "100%",
                    width: `${Math.max(2, (Number(item.paid || 0) / max) * 100)}%`,
                    bgcolor: "success.main"
                  }}
                />
              </Box>
            </Tooltip>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export default function AnalyticsDashboard() {
  const navigate = useNavigate();
  const [range, setRange] = React.useState("30");
  const [payer, setPayer] = React.useState("");
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await AnalyticsApi.dashboard({ range, payer }));
    } catch (e) {
      setError(e?.message || "Analytics dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [range, payer]);

  React.useEffect(() => {
    load();
  }, [load]);

  const kpis = data?.kpis || {};
  const funnel = data?.funnel || [];
  const aging = data?.aging || [];
  const denialCauses = data?.denialCauses || [];
  const payerPerformance = data?.payerPerformance || [];
  const trend = data?.trend || [];
  const payerOptions = data?.filters?.payerOptions || [];
  const disposition = [
    { label: "Paid", value: Number(kpis.paidClaims || 0), color: "#2F7D5B" },
    { label: "Denied", value: Number(kpis.deniedClaims || 0), color: "#C84C4C" },
    {
      label: "Other / Open",
      value: Math.max(0, Number(kpis.totalClaims || 0) - Number(kpis.paidClaims || 0) - Number(kpis.deniedClaims || 0)),
      color: "#5B7FA3"
    }
  ];

  const maxFunnel = Math.max(1, ...funnel.map((item) => Number(item.value || 0)));

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", lg: "center" }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Analytics & Operations
          </Typography>
          <Typography color="text.secondary">
            Financial performance, claim flow, payer outcomes, A/R aging, and recovery work from recorded PRISM data.
          </Typography>
        </Box>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Date range</InputLabel>
            <Select
              label="Date range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              data-testid="analytics-range"
            >
              <MenuItem value="30">Last 30 days</MenuItem>
              <MenuItem value="90">Last 90 days</MenuItem>
              <MenuItem value="ALL">All time</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 210 }}>
            <InputLabel>Payer</InputLabel>
            <Select
              label="Payer"
              value={payer}
              onChange={(event) => setPayer(event.target.value)}
              data-testid="analytics-payer"
            >
              <MenuItem value="">All payers</MenuItem>
              {payerOptions.map((name) => (
                <MenuItem key={name} value={name}>{name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button variant="outlined" startIcon={<Refresh />} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Dashboard values are calculated from recorded claim, adjudication, remittance, denial, and recovery data.
        Denial rate is based on adjudicated claims only; it is not presented as a payer approval probability or a guaranteed denial-reduction result.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && !data ? (
        <Paper sx={{ p: 7, textAlign: "center" }}>
          <CircularProgress />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading analytics...
          </Typography>
        </Paper>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(4, minmax(0, 1fr))"
              },
              gap: 2,
              mb: 2
            }}
          >
            <MetricCard
              title="Total Billed"
              value={formatUSD(kpis.totalBilled)}
              subtitle={`${kpis.totalClaims || 0} claims in selected cohort`}
              icon={<Assessment color="primary" />}
              onClick={() => navigate("/claims")}
              testId="analytics-total-billed"
            />
            <MetricCard
              title="Paid"
              value={formatUSD(kpis.totalPaid)}
              subtitle={`${kpis.paidClaims || 0} paid claims`}
              icon={<CheckCircleOutline color="success" />}
              onClick={() => navigate("/claims")}
              testId="analytics-paid"
            />
            <MetricCard
              title="Outstanding"
              value={formatUSD(kpis.outstanding)}
              subtitle="Recorded unpaid claim value"
              icon={<Schedule color="warning" />}
              onClick={() => navigate("/approval")}
              testId="analytics-outstanding"
            />
            <MetricCard
              title="Recovered"
              value={formatUSD(kpis.recovered)}
              subtitle={`${kpis.activeRecovery || 0} active recovery opportunities`}
              icon={<AccountBalanceWallet color="success" />}
              onClick={() => navigate("/revenue-recovery")}
              testId="analytics-recovered"
            />

            <MetricCard
              title="Denial Rate"
              value={pct(kpis.denialRate)}
              subtitle={`${kpis.deniedClaims || 0} denied · adjudicated claims only`}
              icon={<TrendingDown color="error" />}
              onClick={() => navigate("/revenue-recovery")}
              testId="analytics-denial-rate"
            />
            <MetricCard
              title="Ready to Submit"
              value={kpis.readyToSubmit || 0}
              subtitle={`${kpis.needsReview || 0} claims still need review`}
              icon={<TrendingUp color="success" />}
              onClick={() => navigate("/approval")}
              testId="analytics-ready"
            />
            <MetricCard
              title="Eligibility Issues"
              value={kpis.eligibilityIssues || 0}
              subtitle="Unsubmitted claims without verified eligibility"
              icon={<WarningAmber color="warning" />}
              onClick={() => navigate("/approval")}
              testId="analytics-eligibility"
            />
            <MetricCard
              title="Prior Auth Issues"
              value={kpis.priorAuthIssues || 0}
              subtitle="Required authorization not resolved"
              icon={<WarningAmber color="warning" />}
              onClick={() => navigate("/approval")}
              testId="analytics-prior-auth"
            />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "0.8fr 1.15fr 1fr" },
              gap: 1.5,
              mb: 2
            }}
          >
            <Paper sx={{ p: 1.75 }} data-testid="analytics-disposition-donut">
              <Typography variant="h6" fontWeight={800}>Claim Disposition</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                Current cohort by recorded paid, denied, and remaining/open claim state.
              </Typography>
              <DonutChart
                items={disposition}
                centerLabel="claims"
                centerValue={kpis.totalClaims || 0}
              />
            </Paper>

            <Paper sx={{ p: 1.75 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>Claim Funnel</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Current cohort progression; ready-now remains current-state inventory.
                  </Typography>
                </Box>
                <Button size="small" endIcon={<ArrowForward />} onClick={() => navigate("/approval")}>
                  Work Queue
                </Button>
              </Stack>
              <Stack spacing={1}>
                {funnel.map((item) => (
                  <Box key={item.label}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={650}>{item.label}</Typography>
                      <Typography variant="body2">{item.value}</Typography>
                    </Stack>
                    <Box sx={{ mt: 0.4, height: 9, bgcolor: "action.hover", borderRadius: 999, overflow: "hidden" }}>
                      <Box
                        sx={{
                          height: "100%",
                          width: `${Math.max(2, (Number(item.value || 0) / maxFunnel) * 100)}%`,
                          bgcolor:
                            item.label === "Paid" ? "success.main" :
                            item.label === "Denied" ? "error.main" :
                            "primary.main",
                          borderRadius: 999
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Paper>

            <Paper sx={{ p: 1.75 }} data-testid="analytics-aging-columns">
              <Typography variant="h6" fontWeight={800}>A/R Aging</Typography>
              <Typography variant="body2" color="text.secondary">
                Outstanding submitted claims grouped by age.
              </Typography>
              {aging.length ? <ColumnChart items={aging} /> : (
                <Typography color="text.secondary" sx={{ mt: 2 }}>No aging data for this selection.</Typography>
              )}
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">Recovery outstanding</Typography>
                <Typography fontWeight={800}>{formatUSD(kpis.recoveryOutstanding)}</Typography>
              </Stack>
            </Paper>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "1.15fr 1fr" },
              gap: 2,
              mb: 2
            }}
          >
            <Paper sx={{ p: 1.75 }}>
              <Typography variant="h6" fontWeight={800}>Billed vs Paid Trend</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Financial movement with submitted and denied claim counts in each period.
              </Typography>
              {trend.length ? <TrendPanel trend={trend} /> : (
                <Typography color="text.secondary">No trend data for this selection.</Typography>
              )}
            </Paper>

            <Paper sx={{ p: 1.75 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>Top Denial Causes</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Ranked by currently unrecovered dollars at risk.
                  </Typography>
                </Box>
                <Button size="small" endIcon={<ArrowForward />} onClick={() => navigate("/revenue-recovery")}>
                  Recovery
                </Button>
              </Stack>
              {denialCauses.length ? (
                <BarList items={denialCauses} valueKey="atRisk" />
              ) : (
                <Alert severity="success">No denial dollars at risk in this selection.</Alert>
              )}
            </Paper>
          </Box>

          <Paper sx={{ mb: 2 }}>
            <Box sx={{ p: 2.5, pb: 1.5 }}>
              <Typography variant="h6" fontWeight={800}>Payer Performance</Typography>
              <Typography variant="body2" color="text.secondary">
                Operational comparison using the selected claim cohort and recorded payment outcomes.
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><b>Payer</b></TableCell>
                    <TableCell align="right"><b>Claims</b></TableCell>
                    <TableCell align="right"><b>Submitted</b></TableCell>
                    <TableCell align="right"><b>Denial Rate</b></TableCell>
                    <TableCell align="right"><b>Avg Days to Pay</b></TableCell>
                    <TableCell align="right"><b>Paid</b></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payerPerformance.map((row) => (
                    <TableRow key={row.payer} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography fontWeight={650}>{row.payer}</Typography>
                          {payer === row.payer && <Chip size="small" label="Filtered" />}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">{row.claims}</TableCell>
                      <TableCell align="right">{row.submitted}</TableCell>
                      <TableCell align="right">{pct(row.denialRate)}</TableCell>
                      <TableCell align="right">{row.avgDaysToPay == null ? "—" : row.avgDaysToPay}</TableCell>
                      <TableCell align="right">{formatUSD(row.paidAmount)}</TableCell>
                    </TableRow>
                  ))}
                  {!payerPerformance.length && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          No payer performance data for this selection.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ p: 1.75 }}>
            <Typography variant="h6" fontWeight={800}>How these metrics are calculated</Typography>
            <Stack spacing={0.8} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">{data?.methodology?.cohort}</Typography>
              <Typography variant="body2" color="text.secondary">{data?.methodology?.denialRate}</Typography>
              <Typography variant="body2" color="text.secondary">{data?.methodology?.outstanding}</Typography>
              <Typography variant="body2" color="text.secondary">{data?.methodology?.aging}</Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
}
