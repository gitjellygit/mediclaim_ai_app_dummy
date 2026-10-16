import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import { ClaimsApi } from "../../api/claims.js";

function dateInput(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function isoDate(value) {
  return value ? value + "T00:00:00.000Z" : null;
}

function operatorsFor(field, operators) {
  if (!field) return operators;
  if (field.type === "number") {
    return operators.filter((item) =>
      ["REQUIRED", "EQUALS", "NOT_EQUALS", "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"].includes(item.id)
    );
  }
  if (field.type === "boolean") {
    return operators.filter((item) => ["REQUIRED", "EQUALS", "NOT_EQUALS"].includes(item.id));
  }
  if (field.type === "date") {
    return operators.filter((item) => ["REQUIRED", "EQUALS", "NOT_EQUALS"].includes(item.id));
  }
  return operators.filter((item) =>
    ["REQUIRED", "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "MATCHES"].includes(item.id)
  );
}

function coerceValue(value, field) {
  if (!field) return value;
  if (field.type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (field.type === "boolean") return value === true || value === "true";
  return value;
}

export default function RuleForm({ rule = null, onSaved, onCancel }) {
  const [meta, setMeta] = React.useState(null);
  const [form, setForm] = React.useState({
    code: "",
    name: "",
    description: "",
    category: "CLAIM",
    severity: "WARN",
    enabled: true,
    scope: "ORGANIZATION",
    payerName: "",
    payerEdiId: "",
    field: "memberId",
    operator: "REQUIRED",
    value: "",
    useAppliesWhen: false,
    whenField: "claimForm",
    whenOperator: "EQUALS",
    whenValue: "",
    version: "1.0",
    effectiveFrom: "",
    effectiveTo: ""
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    ClaimsApi.getRulesMeta()
      .then(setMeta)
      .catch((e) => setError(e?.message || "Rule metadata could not be loaded."));
  }, []);

  React.useEffect(() => {
    if (!rule) return;
    const definition = rule.definition || {};
    const when = definition.appliesWhen || {};
    setForm({
      code: rule.code || "",
      name: rule.name || "",
      description: rule.description || "",
      category: rule.category || "CLAIM",
      severity: rule.severity || "WARN",
      enabled: rule.enabled !== false,
      scope: rule.scope || "ORGANIZATION",
      payerName: rule.payerName || "",
      payerEdiId: rule.payerEdiId || "",
      field: definition.field || "memberId",
      operator: definition.operator || "REQUIRED",
      value: Array.isArray(definition.value) ? definition.value.join(", ") : (definition.value ?? ""),
      useAppliesWhen: Boolean(when.field),
      whenField: when.field || "claimForm",
      whenOperator: when.operator || "EQUALS",
      whenValue: Array.isArray(when.value) ? when.value.join(", ") : (when.value ?? ""),
      version: rule.version || "1.0",
      effectiveFrom: dateInput(rule.effectiveFrom),
      effectiveTo: dateInput(rule.effectiveTo)
    });
  }, [rule]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  if (!meta) {
    return (
      <Card>
        <CardContent>
          {error ? <Alert severity="error">{error}</Alert> : <Typography>Loading rule configuration…</Typography>}
        </CardContent>
      </Card>
    );
  }

  const fieldMeta = meta.fields.find((item) => item.id === form.field);
  const whenFieldMeta = meta.fields.find((item) => item.id === form.whenField);
  const allowedOperators = operatorsFor(fieldMeta, meta.operators);
  const allowedWhenOperators = operatorsFor(whenFieldMeta, meta.operators);
  const systemManaged = rule?.systemManaged === true;
  const mandatory = rule?.mandatory === true;

  async function submit() {
    if (systemManaged) {
      try {
        setSaving(true);
        await ClaimsApi.updateRule(rule.id, {
          enabled: form.enabled,
          severity: form.severity
        });
        onSaved?.();
      } catch (e) {
        setError(e?.message || "Rule could not be updated.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.code.trim() || !form.name.trim()) {
      setError("Rule code and name are required.");
      return;
    }
    if (form.scope === "PAYER" && !form.payerName.trim() && !form.payerEdiId.trim()) {
      setError("Payer-scoped rules require a payer name or payer EDI ID.");
      return;
    }
    if (form.operator !== "REQUIRED" && String(form.value).trim() === "") {
      setError("Enter the expected value for this rule.");
      return;
    }

    const definition = {
      field: form.field,
      operator: form.operator,
      ...(form.operator === "REQUIRED"
        ? {}
        : { value: coerceValue(form.value, fieldMeta) }),
      ...(form.useAppliesWhen
        ? {
            appliesWhen: {
              field: form.whenField,
              operator: form.whenOperator,
              ...(form.whenOperator === "REQUIRED"
                ? {}
                : { value: coerceValue(form.whenValue, whenFieldMeta) })
            }
          }
        : {})
    };

    const payload = {
      ...(!rule ? { code: form.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") } : {}),
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category,
      severity: form.severity,
      enabled: form.enabled,
      scope: form.scope,
      payerName: form.scope === "PAYER" ? form.payerName.trim() || null : null,
      payerEdiId: form.scope === "PAYER" ? form.payerEdiId.trim() || null : null,
      definition,
      version: form.version.trim() || "1.0",
      effectiveFrom: isoDate(form.effectiveFrom),
      effectiveTo: isoDate(form.effectiveTo)
    };

    try {
      setSaving(true);
      if (rule) await ClaimsApi.updateRule(rule.id, payload);
      else await ClaimsApi.createRule(payload);
      onSaved?.();
    } catch (e) {
      setError(e?.message || "Rule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2.25}>
          {systemManaged && (
            <Alert severity={mandatory ? "warning" : "info"}>
              {mandatory
                ? "This is a mandatory system safeguard. Its implementation, severity and enabled state are locked."
                : "This rule is implemented by the system. Only its enabled state and severity can be overridden."}
            </Alert>
          )}

          <Box>
            <Typography variant="h5" fontWeight={800}>
              {rule ? "Edit Rule" : "Add Rule"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Rules are deterministic claim checks. Custom rules use approved fields and operators only; no executable code is stored.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              fullWidth
              label="Rule Code"
              value={form.code}
              disabled={Boolean(rule)}
              onChange={(e) => update("code", e.target.value.toUpperCase())}
              helperText="Stable machine identifier, e.g. AETNA_RENDERING_NPI"
            />
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={form.category}
                disabled={systemManaged}
                onChange={(e) => update("category", e.target.value)}
              >
                {meta.categories.map((item) => (
                  <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label="Name"
            value={form.name}
            disabled={systemManaged}
            onChange={(e) => update("name", e.target.value)}
          />
          <TextField
            multiline
            minRows={2}
            label="Description / failure message"
            value={form.description}
            disabled={systemManaged}
            onChange={(e) => update("description", e.target.value)}
            helperText="Shown to claim users when the expectation is not met."
          />

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Severity</InputLabel>
              <Select
                label="Severity"
                value={form.severity}
                disabled={mandatory}
                onChange={(e) => update("severity", e.target.value)}
              >
                {meta.severities.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Scope</InputLabel>
              <Select
                label="Scope"
                value={form.scope}
                disabled={systemManaged}
                onChange={(e) => update("scope", e.target.value)}
              >
                <MenuItem value="ORGANIZATION">All organization claims</MenuItem>
                <MenuItem value="PAYER">Specific payer</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={<Switch checked={form.enabled} disabled={mandatory} onChange={(e) => update("enabled", e.target.checked)} />}
              label="Enabled"
            />
          </Stack>

          {form.scope === "PAYER" && !systemManaged && (
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField fullWidth label="Payer Name" value={form.payerName} onChange={(e) => update("payerName", e.target.value)} />
              <TextField fullWidth label="Payer EDI ID" value={form.payerEdiId} onChange={(e) => update("payerEdiId", e.target.value)} />
            </Stack>
          )}

          {!systemManaged && (
            <>
              <Typography variant="subtitle1" fontWeight={800}>Rule expectation</Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Field</InputLabel>
                  <Select label="Field" value={form.field} onChange={(e) => update("field", e.target.value)}>
                    {meta.fields.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.label} · {item.category.replaceAll("_", " ")}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Expectation</InputLabel>
                  <Select label="Expectation" value={form.operator} onChange={(e) => update("operator", e.target.value)}>
                    {allowedOperators.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
                  </Select>
                </FormControl>
                {form.operator !== "REQUIRED" && (
                  fieldMeta?.type === "boolean" ? (
                    <FormControl fullWidth>
                      <InputLabel>Value</InputLabel>
                      <Select label="Value" value={String(form.value)} onChange={(e) => update("value", e.target.value)}>
                        <MenuItem value="true">True</MenuItem>
                        <MenuItem value="false">False</MenuItem>
                      </Select>
                    </FormControl>
                  ) : (
                    <TextField
                      fullWidth
                      label={["IN", "NOT_IN"].includes(form.operator) ? "Values (comma separated)" : "Expected value"}
                      type={fieldMeta?.type === "number" ? "number" : "text"}
                      value={form.value}
                      onChange={(e) => update("value", e.target.value)}
                    />
                  )
                )}
              </Stack>

              <FormControlLabel
                control={<Switch checked={form.useAppliesWhen} onChange={(e) => update("useAppliesWhen", e.target.checked)} />}
                label="Apply this rule only when another claim condition is true"
              />

              {form.useAppliesWhen && (
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel>When field</InputLabel>
                    <Select label="When field" value={form.whenField} onChange={(e) => update("whenField", e.target.value)}>
                      {meta.fields.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth>
                    <InputLabel>When</InputLabel>
                    <Select label="When" value={form.whenOperator} onChange={(e) => update("whenOperator", e.target.value)}>
                      {allowedWhenOperators.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  {form.whenOperator !== "REQUIRED" && (
                    whenFieldMeta?.type === "boolean" ? (
                      <FormControl fullWidth>
                        <InputLabel>When value</InputLabel>
                        <Select label="When value" value={String(form.whenValue)} onChange={(e) => update("whenValue", e.target.value)}>
                          <MenuItem value="true">True</MenuItem>
                          <MenuItem value="false">False</MenuItem>
                        </Select>
                      </FormControl>
                    ) : (
                      <TextField fullWidth label="When value" value={form.whenValue} onChange={(e) => update("whenValue", e.target.value)} />
                    )
                  )}
                </Stack>
              )}

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField fullWidth label="Version" value={form.version} onChange={(e) => update("version", e.target.value)} />
                <TextField fullWidth label="Effective From" type="date" InputLabelProps={{ shrink: true }} value={form.effectiveFrom} onChange={(e) => update("effectiveFrom", e.target.value)} />
                <TextField fullWidth label="Effective To" type="date" InputLabelProps={{ shrink: true }} value={form.effectiveTo} onChange={(e) => update("effectiveTo", e.target.value)} />
              </Stack>
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button variant="contained" onClick={submit} disabled={saving || mandatory}>
              {saving ? "Saving…" : "Save Rule"}
            </Button>
          </Stack>

          {mandatory && <Chip label="Mandatory system safeguard" color="warning" sx={{ alignSelf: "flex-start" }} />}
        </Stack>
      </CardContent>
    </Card>
  );
}
