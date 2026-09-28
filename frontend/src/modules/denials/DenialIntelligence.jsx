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
  FormControl,
  InputAdornment,
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
  TextField,
  Typography
} from "@mui/material";
import {
  AutoAwesome,
  Refresh,
  Search as SearchIcon,
  Visibility
} from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
import { DenialsApi } from "../../api/denials.js";
import { useToast } from "../../context/ToastContext.jsx";

function money(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
}

function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US");
}

function statusColor(status) {
  if (["OVERTURNED", "CLOSED"].includes(status)) return "success";
  if (["UPHELD"].includes(status)) return "error";
  if (["APPEAL_SUBMITTED", "RESUBMITTED"].includes(status)) return "info";
  if (["CORRECTION_REQUIRED", "APPEAL_PREPARED"].includes(status)) return "warning";
  return "default";
}

function categoryColor(category) {
  if (["AUTHORIZATION", "ELIGIBILITY"].includes(category)) return "warning";
  if (["CODING", "DOCUMENTATION"].includes(category)) return "info";
  return "default";
}

const CASE_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED",
  "OVERTURNED",
  "UPHELD",
  "CLOSED"
];

export default function DenialIntelligence() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, showDialog } = useToast();

  const [rows, setRows] = React.useState([]);
  const [metrics, setMetrics] = React.useState({
    openCases: 0,
    revenueAtRisk: 0,
    appealEligible: 0,
    recoveredAmount: 0,
    topCategory: "—"
  });
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState("");
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [action, setAction] = React.useState("");

  const [edit, setEdit] = React.useState({
    denialCategory: "",
    groupCode: "",
    carcCode: "",
    rarcCode: "",
    appealEligible: "",
    correctable: "",
    appealDeadline: "",
    status: "OPEN",
    recoveredAmount: ""
  });

  const requestRef = React.useRef(0);

  const load = React.useCallback(async (query = search, status = statusFilter) => {
    const requestId = ++requestRef.current;
    setLoading(true);

    try {
      const result = await DenialsApi.list({
        query: query.trim(),
        status,
        limit: 100
      });

      if (requestId !== requestRef.current) return;

      setRows(Array.isArray(result?.items) ? result.items : []);
      setMetrics(result?.metrics || {
        openCases: 0,
        revenueAtRisk: 0,
        appealEligible: 0,
        recoveredAmount: 0,
        topCategory: "—"
      });
    } catch (error) {
      if (requestId !== requestRef.current) return;
      showDialog(
        error?.message || "Denial cases could not be loaded. Please try again.",
        {
          title: "Unable to load Denial Intelligence",
          severity: "error"
        }
      );
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [search, statusFilter, showDialog]);

  React.useEffect(() => {
    load("", "ALL");
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      load(search, statusFilter);
    }, 350);

    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  async function openDetail(id) {
    setSelectedId(id);
    setDetailLoading(true);

    try {
      const data = await DenialsApi.get(id);
      setDetail(data);
      setEdit({
        denialCategory: data.denialCategory || "",
        groupCode: data.groupCode || "",
        carcCode: data.carcCode || "",
        rarcCode: data.rarcCode || "",
        appealEligible:
          data.appealEligible == null
            ? ""
            : data.appealEligible
            ? "YES"
            : "NO",
        correctable:
          data.correctable == null
            ? ""
            : data.correctable
            ? "YES"
            : "NO",
        appealDeadline: data.appealDeadline
          ? new Date(data.appealDeadline).toISOString().slice(0, 10)
          : "",
        status: data.status || "OPEN",
        recoveredAmount: data.recoveredAmount ?? ""
      });
    } catch (error) {
      setSelectedId("");
      setDetail(null);
      showDialog(
        error?.message || "The denial case could not be loaded.",
        {
          title: "Unable to open denial case",
          severity: "error"
        }
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveCase() {
    if (!detail) return;
    setAction("save");

    try {
      await DenialsApi.update(detail.id, {
        denialCategory: edit.denialCategory,
        groupCode: edit.groupCode,
        carcCode: edit.carcCode,
        rarcCode: edit.rarcCode,
        appealEligible:
          edit.appealEligible === ""
            ? undefined
            : edit.appealEligible === "YES",
        correctable:
          edit.correctable === ""
            ? undefined
            : edit.correctable === "YES",
        appealDeadline: edit.appealDeadline || null,
        status: edit.status,
        recoveredAmount:
          edit.recoveredAmount === ""
            ? null
            : Number(edit.recoveredAmount)
      });

      showToast("Denial case updated", "success");
      await openDetail(detail.id);
      await load();
    } catch (error) {
      showDialog(
        error?.message || "The denial case could not be updated.",
        {
          title: "Denial case update failed",
          severity: "error"
        }
      );
    } finally {
      setAction("");
    }
  }

  async function runAI() {
    if (!detail) return;
    setAction("ai");

    try {
      const result = await DenialsApi.analyze(detail.id);
      await openDetail(detail.id);
      await load();

      if (result?.ai?.llmUsed) {
        showToast(
          `LLM analysis completed with ${result.ai.model}`,
          "success"
        );
      } else {
        showDialog(
          result?.ai?.llmReason ||
            "Deterministic denial rules were used. No external LLM was called.",
          {
            title: "AI analysis completed with rule engine",
            severity: "info"
          }
        );
      }
    } catch (error) {
      showDialog(
        error?.message || "Denial AI analysis could not be completed.",
        {
          title: "AI analysis failed",
          severity: "error"
        }
      );
    } finally {
      setAction("");
    }
  }

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
            Denial & Appeal Intelligence
          </Typography>
          <Typography color="text.secondary">
            Identify denial drivers, revenue at risk, and the next best recovery action.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        AI recommendations are decision support only. Payer denial codes, remittance data,
        authorization status, eligibility, claim facts, and supporting documents remain
        the source of truth.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            lg: "repeat(5, 1fr)"
          },
          gap: 2,
          mb: 3
        }}
      >
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Active Denials
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {metrics.openCases}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Revenue at Risk
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {money(metrics.revenueAtRisk)}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Appeal Eligible
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {metrics.appealEligible}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Recovered
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {money(metrics.recoveredAmount)}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Top Denial Category
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {metrics.topCategory}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Search patient, payer, policy, claim number, CARC/RARC or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
          />

          <FormControl size="small" sx={{ minWidth: 210 }}>
            <InputLabel>Case Status</InputLabel>
            <Select
              label="Case Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="ALL">All statuses</MenuItem>
              {CASE_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {loading ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress size={34} />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Loading denial intelligence...
          </Typography>
        </Paper>
      ) : rows.length === 0 ? (
        <Alert severity="info">
          No denial cases match the current search. Setting a submitted claim to
          DENIED or PARTIALLY APPROVED in Claim Journey will automatically open a case.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><b>Patient / Payer</b></TableCell>
                <TableCell><b>Category</b></TableCell>
                <TableCell><b>CARC / RARC</b></TableCell>
                <TableCell><b>Revenue at Risk</b></TableCell>
                <TableCell><b>Appeal</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell><b>AI</b></TableCell>
                <TableCell align="right"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>
                      {row.claim?.patientName || "Unknown Patient"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {row.claim?.payerName || "—"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.claim?.insurerClaimNo
                        ? `Claim ${row.claim.insurerClaimNo}`
                        : row.claim?.policyNo
                        ? `Policy ${row.claim.policyNo}`
                        : "No payer claim number"}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      label={row.denialCategory || "UNCLASSIFIED"}
                      color={categoryColor(row.denialCategory)}
                      variant="outlined"
                    />
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2">
                      {row.carcCode || "—"} / {row.rarcCode || "—"}
                    </Typography>
                    {row.groupCode && (
                      <Typography variant="caption" color="text.secondary">
                        Group {row.groupCode}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <Typography fontWeight={600}>
                      {money(row.revenueAtRisk)}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    {row.appealEligible == null ? (
                      <Chip size="small" label="Not assessed" variant="outlined" />
                    ) : (
                      <Chip
                        size="small"
                        label={row.appealEligible ? "Eligible" : "Not eligible"}
                        color={row.appealEligible ? "success" : "default"}
                      />
                    )}
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      label={row.status.replaceAll("_", " ")}
                      color={statusColor(row.status)}
                    />
                  </TableCell>

                  <TableCell>
                    {row.aiAnalyzedAt ? (
                      <Stack spacing={0.5} alignItems="flex-start">
                        <Chip
                          size="small"
                          icon={<AutoAwesome />}
                          color={row.aiProvider === "OPENAI" ? "secondary" : "info"}
                          label={
                            row.aiProvider === "OPENAI"
                              ? "LLM + Rules"
                              : "Rules AI"
                          }
                        />
                        <Typography variant="caption" color="text.secondary">
                          {row.aiConfidence ?? "—"}% confidence
                        </Typography>
                      </Stack>
                    ) : (
                      <Chip size="small" label="Not analyzed" variant="outlined" />
                    )}
                  </TableCell>

                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<Visibility />}
                      onClick={() => openDetail(row.id)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Drawer
        anchor="right"
        open={Boolean(selectedId)}
        onClose={() => {
          setSelectedId("");
          setDetail(null);
        }}
        PaperProps={{
          sx: {
            width: { xs: "100%", sm: 560 },
            p: 3
          }
        }}
      >
        {detailLoading || !detail ? (
          <Box sx={{ p: 5, textAlign: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h5" fontWeight={700}>
                Denial Case Review
              </Typography>
              <Typography color="text.secondary">
                {detail.claim?.patientName} • {detail.claim?.payerName}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip
                label={detail.status.replaceAll("_", " ")}
                color={statusColor(detail.status)}
              />
              <Chip
                label={detail.denialCategory || "UNCLASSIFIED"}
                variant="outlined"
              />
              <Chip
                label={`Revenue at risk ${money(detail.revenueAtRisk)}`}
                color="warning"
                variant="outlined"
              />
            </Stack>

            <Divider />

            <Typography variant="h6">Payer / Denial Data</Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1.5
              }}
            >
              <TextField
                size="small"
                label="Denial Category"
                value={edit.denialCategory}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    denialCategory: e.target.value
                  }))
                }
              />
              <TextField
                size="small"
                label="Group Code"
                value={edit.groupCode}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    groupCode: e.target.value
                  }))
                }
              />
              <TextField
                size="small"
                label="CARC"
                value={edit.carcCode}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    carcCode: e.target.value
                  }))
                }
              />
              <TextField
                size="small"
                label="RARC"
                value={edit.rarcCode}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    rarcCode: e.target.value
                  }))
                }
              />
            </Box>

            {detail.reasonText && (
              <Alert severity="warning">
                <b>Payer reason:</b> {detail.reasonText}
              </Alert>
            )}

            <Divider />

            <Typography variant="h6">Appeal Workflow</Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1.5
              }}
            >
              <FormControl size="small">
                <InputLabel>Appeal Eligible?</InputLabel>
                <Select
                  label="Appeal Eligible?"
                  value={edit.appealEligible}
                  onChange={(e) =>
                    setEdit((current) => ({
                      ...current,
                      appealEligible: e.target.value
                    }))
                  }
                >
                  <MenuItem value="">Unknown</MenuItem>
                  <MenuItem value="YES">Yes</MenuItem>
                  <MenuItem value="NO">No</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small">
                <InputLabel>Correctable?</InputLabel>
                <Select
                  label="Correctable?"
                  value={edit.correctable}
                  onChange={(e) =>
                    setEdit((current) => ({
                      ...current,
                      correctable: e.target.value
                    }))
                  }
                >
                  <MenuItem value="">Unknown</MenuItem>
                  <MenuItem value="YES">Yes</MenuItem>
                  <MenuItem value="NO">No</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                type="date"
                label="Appeal Deadline"
                InputLabelProps={{ shrink: true }}
                value={edit.appealDeadline}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    appealDeadline: e.target.value
                  }))
                }
              />

              <TextField
                size="small"
                type="number"
                label="Recovered Amount"
                value={edit.recoveredAmount}
                onChange={(e) =>
                  setEdit((current) => ({
                    ...current,
                    recoveredAmount: e.target.value
                  }))
                }
              />

              <FormControl size="small" sx={{ gridColumn: "1 / -1" }}>
                <InputLabel>Case Status</InputLabel>
                <Select
                  label="Case Status"
                  value={edit.status}
                  onChange={(e) =>
                    setEdit((current) => ({
                      ...current,
                      status: e.target.value
                    }))
                  }
                >
                  {CASE_STATUSES.map((status) => (
                    <MenuItem key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Button
              variant="outlined"
              onClick={saveCase}
              disabled={Boolean(action)}
            >
              {action === "save" ? "Saving..." : "Save Case"}
            </Button>

            <Divider />

            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography variant="h6">
                  AI Denial Analysis
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Grounded in payer/claim facts. LLM use is explicitly identified.
                </Typography>
              </Box>

              <Button
                variant="contained"
                startIcon={<AutoAwesome />}
                onClick={runAI}
                disabled={Boolean(action)}
              >
                {action === "ai" ? "Analyzing..." : "Run AI Analysis"}
              </Button>
            </Stack>

            {detail.aiAnalyzedAt ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip
                      size="small"
                      icon={<AutoAwesome />}
                      color={detail.aiProvider === "OPENAI" ? "secondary" : "info"}
                      label={
                        detail.aiProvider === "OPENAI"
                          ? `LLM: ${detail.aiModel}`
                          : "Deterministic Rules"
                      }
                    />
                    <Chip
                      size="small"
                      label={`${detail.aiConfidence ?? "—"}% confidence`}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={`Analyzed ${date(detail.aiAnalyzedAt)}`}
                      variant="outlined"
                    />
                  </Stack>

                  <Box>
                    <Typography variant="subtitle2">
                      Why this denial likely occurred
                    </Typography>
                    <Typography variant="body2">
                      {detail.aiExplanation || "—"}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2">
                      Recommended next action
                    </Typography>
                    <Typography variant="body2">
                      {detail.recommendedAction || "—"}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2">
                      Suggested supporting documents
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      sx={{ mt: 0.5 }}
                    >
                      {(Array.isArray(detail.requiredDocuments)
                        ? detail.requiredDocuments
                        : []
                      ).map((item) => (
                        <Chip
                          key={item}
                          size="small"
                          label={String(item).replaceAll("_", " ")}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  </Box>
                </Stack>
              </Paper>
            ) : (
              <Alert severity="info">
                Run AI Analysis to classify likely denial drivers and recommend the next recovery action.
              </Alert>
            )}

            <Button
              startIcon={<Visibility />}
              onClick={() =>
                navigate(`/claims/${detail.claimId}`, {
                  state: {
                    from: location.pathname + location.search,
                    backLabel: "Back to Denial Intelligence"
                  }
                })
              }
            >
              Open Claim Detail
            </Button>
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
