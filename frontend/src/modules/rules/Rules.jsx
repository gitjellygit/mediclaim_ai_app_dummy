import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  Add,
  AdminPanelSettings,
  Lock,
  Refresh,
  Search as SearchIcon,
  Shield,
  Tune
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { useToast } from "../../context/ToastContext.jsx";

const severityColor = {
  INFO: "info",
  WARN: "warning",
  BLOCK: "error"
};

function effectiveLabel(rule) {
  if (!rule.effectiveFrom && !rule.effectiveTo) return "Always";
  const from = rule.effectiveFrom
    ? new Date(rule.effectiveFrom).toLocaleDateString("en-US")
    : "Now";
  const to = rule.effectiveTo
    ? new Date(rule.effectiveTo).toLocaleDateString("en-US")
    : "No end";
  return from + " → " + to;
}

function summaryCard(label, value, caption) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h4" fontWeight={900}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Rules() {
  const [data, setData] = React.useState({
    items: [],
    unconfiguredSystemRules: []
  });
  const [meta, setMeta] = React.useState(null);
  const [recommendations, setRecommendations] = React.useState([]);
  const [recommendationAction, setRecommendationAction] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("ALL");
  const [kind, setKind] = React.useState("ALL");
  const [sort, setSort] = React.useState("name");
  const [direction, setDirection] = React.useState("asc");
  const [page, setPage] = React.useState(0);
  const pageSize = 10;
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const navigate = useNavigate();
  const { showDialog, showToast, confirmDialog } = useToast();

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [rules, metadata, recommendationData] = await Promise.all([
        ClaimsApi.listRules(),
        ClaimsApi.getRulesMeta(),
        ClaimsApi.listRuleRecommendations()
      ]);
      setData({
        items: Array.isArray(rules?.items) ? rules.items : [],
        unconfiguredSystemRules: Array.isArray(rules?.unconfiguredSystemRules)
          ? rules.unconfiguredSystemRules
          : []
      });
      setMeta(metadata);
      setRecommendations(
        Array.isArray(recommendationData?.items) ? recommendationData.items : []
      );
    } catch (error) {
      showDialog(error?.message || "Rules could not be loaded.", {
        title: "Unable to load rules",
        severity: "error"
      });
    } finally {
      setLoading(false);
    }
  }, [showDialog]);

  React.useEffect(() => {
    load();
  }, [load]);

  const categoryMap = React.useMemo(
    () => new Map((meta?.categories || []).map((item) => [item.id, item.label])),
    [meta]
  );

  const filteredRules = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data.items.filter((rule) => {
      if (category !== "ALL" && rule.category !== category) return false;
      if (kind === "SYSTEM" && !rule.systemManaged) return false;
      if (kind === "CUSTOM" && rule.systemManaged) return false;
      if (kind === "PAYER" && rule.scope !== "PAYER") return false;
      if (!q) return true;
      return [
        rule.code,
        rule.name,
        rule.description,
        rule.payerName,
        rule.payerEdiId,
        rule.category
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });

    const severityRank = { BLOCK: 3, WARN: 2, INFO: 1 };
    const value = (rule) => {
      if (sort === "code") return String(rule.code || "").toLowerCase();
      if (sort === "category") return String(rule.category || "").toLowerCase();
      if (sort === "severity") return severityRank[rule.severity] || 0;
      if (sort === "scope") return String(rule.scope || "").toLowerCase();
      if (sort === "enabled") return rule.enabled ? 1 : 0;
      if (sort === "effective") return new Date(rule.effectiveFrom || "1900-01-01").getTime();
      return String(rule.name || "").toLowerCase();
    };

    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const comparison =
        typeof left === "string"
          ? left.localeCompare(String(right))
          : Number(left) - Number(right);
      return direction === "desc" ? -comparison : comparison;
    });
  }, [data.items, search, category, kind, sort, direction]);

  React.useEffect(() => {
    setPage(0);
  }, [search, category, kind]);

  const pagedRules = filteredRules.slice(page * pageSize, page * pageSize + pageSize);

  function handleSort(field) {
    setPage(0);
    if (sort === field) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(field);
    setDirection(["severity", "enabled"].includes(field) ? "desc" : "asc");
  }

  async function refreshRecommendations() {
    setRecommendationAction("refresh");
    try {
      await ClaimsApi.refreshRuleRecommendations(3);
      await load();
    } catch (error) {
      showDialog(error?.message || "Denial patterns could not be refreshed.", {
        title: "Recommendation refresh failed",
        severity: "error"
      });
    } finally {
      setRecommendationAction("");
    }
  }

  async function approveRecommendation(item) {
    setRecommendationAction(item.id);
    try {
      await ClaimsApi.approveRuleRecommendation(item.id);
      await load();
    } catch (error) {
      showDialog(error?.message || "Recommendation could not be approved.", {
        title: "Recommendation approval failed",
        severity: "error"
      });
    } finally {
      setRecommendationAction("");
    }
  }

  async function rejectRecommendation(item) {
    const confirmed = await confirmDialog(
      "Dismiss this denial-prevention recommendation? The denial evidence remains in Revenue Recovery, but no draft rule will be created.",
      {
        title: "Dismiss recommendation",
        severity: "warning",
        confirmLabel: "Dismiss",
        cancelLabel: "Cancel"
      }
    );
    if (!confirmed) return;

    setRecommendationAction(item.id);
    try {
      await ClaimsApi.rejectRuleRecommendation(
        item.id,
        "Rejected during administrator review"
      );
      await load();
    } catch (error) {
      showDialog(error?.message || "Recommendation could not be dismissed.", {
        title: "Recommendation update failed",
        severity: "error"
      });
    } finally {
      setRecommendationAction("");
    }
  }

  async function toggleRule(rule) {
    if (rule.mandatory) return;
    try {
      await ClaimsApi.updateRule(rule.id, { enabled: !rule.enabled });
      await load();
      showToast(rule.enabled ? "Rule disabled" : "Rule enabled", "success");
    } catch (error) {
      showDialog(error?.message || "Rule status could not be changed.", {
        title: "Rule update failed",
        severity: "error"
      });
    }
  }

  async function deleteRule() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await ClaimsApi.deleteRule(deleteTarget.id);
      await load();
      showToast("Rule archived", "success");
    } catch (error) {
      showDialog(error?.message || "Rule could not be archived.", {
        title: "Rule archive failed",
        severity: "error"
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const activeCount = data.items.filter((rule) => rule.enabled).length;
  const blockCount = data.items.filter(
    (rule) => rule.enabled && rule.severity === "BLOCK"
  ).length;
  const payerCount = data.items.filter(
    (rule) => rule.enabled && rule.scope === "PAYER"
  ).length;
  const customCount = data.items.filter((rule) => !rule.systemManaged).length;

  return (
    <Box sx={{ maxWidth: 1500, mx: "auto", p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={900}>Rules</Typography>
          <Typography color="text.secondary">
            Govern deterministic claim-readiness rules by category, payer, severity and effective period.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<Refresh />} onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => navigate("/rules/new")}>
            Add Rule
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" icon={<Shield />} sx={{ mb: 3 }}>
        Mandatory system safeguards cannot be disabled or downgraded. Admin-created rules use a controlled field/operator model and can be scoped to one payer without executing arbitrary code.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" },
          gap: 2,
          mb: 3
        }}
      >
        {summaryCard("Active Rules", activeCount, "System + custom")}
        {summaryCard("Blocking Rules", blockCount, "Prevent readiness when violated")}
        {summaryCard("Payer-Specific", payerCount, "Scoped by payer name / EDI ID")}
        {summaryCard("Custom Rules", customCount, "Organization-managed expectations")}
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }} data-testid="denial-prevention-recommendations">
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={1}
          sx={{ mb: 1.25 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={850}>Denial Prevention Recommendations</Typography>
            <Typography variant="body2" color="text.secondary">
              Recurring denial patterns can suggest deterministic pre-submit rules. Recommendations never activate automatically.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Refresh />}
            disabled={Boolean(recommendationAction)}
            onClick={refreshRecommendations}
          >
            {recommendationAction === "refresh" ? "Analyzing…" : "Refresh Denial Patterns"}
          </Button>
        </Stack>

        {recommendations.length === 0 ? (
          <Alert severity="info">
            No recurring denial patterns have been promoted for admin review yet. Refresh after enough denial history is available.
          </Alert>
        ) : (
          <Stack spacing={1}>
            {recommendations.slice(0, 8).map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 1.25 }}>
                <Stack
                  direction={{ xs: "column", lg: "row" }}
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mb: 0.5 }}>
                      <Chip size="small" label={item.status} color={item.status === "PENDING" ? "warning" : item.status === "APPROVED" ? "success" : "default"} />
                      <Chip size="small" variant="outlined" label={item.denialCategory} />
                      {item.payerName && <Chip size="small" variant="outlined" label={item.payerName} />}
                      <Chip size="small" variant="outlined" label={`${item.occurrenceCount} denials`} />
                      <Chip size="small" variant="outlined" label={`${Number(item.revenueAtRisk || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} at risk`} />
                    </Stack>
                    <Typography variant="body2">{item.rationale}</Typography>
                    {item.proposedRule ? (
                      <Typography variant="caption" color="text.secondary">
                        Proposed: {item.proposedRule.name} · {item.proposedRule.definition?.field} {item.proposedRule.definition?.operator}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="warning.main">
                        Review only — this pattern does not map safely to a supported deterministic rule.
                      </Typography>
                    )}
                    {item.status === "APPROVED" && (
                      <Typography variant="caption" display="block" color="success.main">
                        Draft rule created disabled. Review and enable it separately when ready.
                      </Typography>
                    )}
                  </Box>

                  {item.status === "PENDING" && (
                    <Stack direction="row" spacing={0.75} alignItems="flex-start">
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!item.proposedRule || Boolean(recommendationAction)}
                        onClick={() => approveRecommendation(item)}
                      >
                        Approve Draft
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        disabled={Boolean(recommendationAction)}
                        onClick={() => rejectRecommendation(item)}
                      >
                        Dismiss
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      {meta && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>
            Rule Coverage
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {meta.categories.map((item) => (
              <Tooltip key={item.id} title={item.description}>
                <Chip
                  label={item.label}
                  variant={category === item.id ? "filled" : "outlined"}
                  color={category === item.id ? "primary" : "default"}
                  onClick={() =>
                    setCategory((current) => (current === item.id ? "ALL" : item.id))
                  }
                />
              </Tooltip>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search rule code, name, payer or description…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              )
            }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Category</InputLabel>
            <Select label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <MenuItem value="ALL">All categories</MenuItem>
              {(meta?.categories || []).map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Rule Type</InputLabel>
            <Select label="Rule Type" value={kind} onChange={(event) => setKind(event.target.value)}>
              <MenuItem value="ALL">All rules</MenuItem>
              <MenuItem value="SYSTEM">System-managed</MenuItem>
              <MenuItem value="CUSTOM">Custom</MenuItem>
              <MenuItem value="PAYER">Payer-specific</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 7, textAlign: "center" }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }} color="text.secondary">Loading rules…</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 1250 }}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "enabled"} direction={sort === "enabled" ? direction : "desc"} onClick={() => handleSort("enabled")}>
                    <b>Status</b>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "code"} direction={sort === "code" ? direction : "asc"} onClick={() => handleSort("code")}>
                    <b>Rule</b>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "category"} direction={sort === "category" ? direction : "asc"} onClick={() => handleSort("category")}>
                    <b>Category</b>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "scope"} direction={sort === "scope" ? direction : "asc"} onClick={() => handleSort("scope")}>
                    <b>Scope</b>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "severity"} direction={sort === "severity" ? direction : "desc"} onClick={() => handleSort("severity")}>
                    <b>Severity</b>
                  </TableSortLabel>
                </TableCell>
                <TableCell><b>Governance</b></TableCell>
                <TableCell><TableSortLabel hideSortIcon={false} sx={{ "& .MuiTableSortLabel-icon": { opacity: "0.35 !important" }, "&.Mui-active .MuiTableSortLabel-icon": { opacity: "1 !important" } }} active={sort === "effective"} direction={sort === "effective" ? direction : "asc"} onClick={() => handleSort("effective")}><b>Effective</b></TableSortLabel></TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedRules.map((rule) => (
                <TableRow key={rule.id} hover>
                  <TableCell>
                    <Tooltip title={rule.mandatory ? "Mandatory system rule is always enabled" : rule.enabled ? "Disable rule" : "Enable rule"}>
                      <span>
                        <Switch
                          checked={Boolean(rule.enabled)}
                          disabled={Boolean(rule.mandatory)}
                          onChange={() => toggleRule(rule)}
                        />
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ minWidth: 280 }}>
                    <Typography fontWeight={800}>{rule.name}</Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                      {rule.code}
                    </Typography>
                    {rule.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {rule.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={categoryMap.get(rule.category) || rule.category} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    {rule.scope === "PAYER" ? (
                      <Stack spacing={0.35}>
                        <Chip size="small" color="secondary" variant="outlined" label="Payer" />
                        <Typography variant="caption">
                          {rule.payerName || rule.payerEdiId || "Unspecified"}
                        </Typography>
                      </Stack>
                    ) : (
                      <Chip size="small" variant="outlined" label="Organization" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={severityColor[rule.severity] || "default"} label={rule.severity} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 190 }}>
                    {rule.systemManaged ? (
                      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                        <Chip size="small" icon={<AdminPanelSettings />} label="System" color="info" variant="outlined" />
                        {rule.mandatory && <Chip size="small" icon={<Lock />} label="Mandatory" color="warning" />}
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                        <Chip size="small" icon={<Tune />} label="Admin rule" variant="outlined" />
                        <Chip size="small" label={"v" + (rule.version || "1.0")} variant="outlined" />
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{effectiveLabel(rule)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                      {!rule.mandatory && (
                        <Button size="small" variant="outlined" onClick={() => navigate("/rules/" + rule.id + "/edit")}>
                          Edit
                        </Button>
                      )}
                      {!rule.systemManaged && (
                        <Button size="small" color="error" onClick={() => setDeleteTarget(rule)}>
                          Archive
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">No rules match the current filters.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={filteredRules.length}
            page={Math.min(page, Math.max(0, Math.ceil(filteredRules.length / pageSize) - 1))}
            onPageChange={(_event, value) => setPage(value)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10]}
            labelRowsPerPage="Rows per page"
          />
        </TableContainer>
      )}

      {meta && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
            gap: 2,
            mt: 3
          }}
        >
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={800}>Built-in Rule Library</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Deterministic rules implemented by the application. Mandatory safeguards stay locked.
              </Typography>
              <Stack spacing={1}>
                {meta.systemCatalog.map((rule) => (
                  <Paper key={rule.code} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography fontWeight={700}>{rule.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{rule.code}</Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Chip size="small" label={rule.severity} color={severityColor[rule.severity]} />
                        {rule.mandatory && <Chip size="small" label="Locked" icon={<Lock />} />}
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={800}>External Rule Sources</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Plug-in points for authoritative rule datasets. The app does not invent or bundle confidential payer/CPT policy content.
              </Typography>
              <Stack spacing={1.25}>
                {meta.externalSources.map((source) => (
                  <Paper key={source.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography fontWeight={700}>{source.name}</Typography>
                        <Typography variant="body2" color="text.secondary">{source.description}</Typography>
                      </Box>
                      <Chip size="small" label={source.status.replaceAll("_", " ")} color={source.status === "CONFIGURABLE" ? "success" : "info"} />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
              <Alert severity="warning" sx={{ mt: 2 }}>
                NCCI/MUE data must be versioned by effective date. Private-payer policy and proprietary code-set content require the appropriate license/contract source before activation.
              </Alert>
            </CardContent>
          </Card>
        </Box>
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>Archive rule?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Archiving “{deleteTarget?.name}” removes it from future readiness checks while preserving its history and audit record.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button color="error" variant="contained" onClick={deleteRule} disabled={deleting}>
            {deleting ? "Archiving…" : "Archive Rule"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
