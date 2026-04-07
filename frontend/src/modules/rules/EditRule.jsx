import React from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  TextField,
  FormControl,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Button,
  CircularProgress
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";

export default function EditRule() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const rule = await ClaimsApi.getRule(id);
        setForm({
          code: rule.code || "",
          name: rule.name || "",
          severity: rule.severity || "WARN",
          enabled: !!rule.enabled
        });
      } catch (e) {
        setError(e.message || "Failed to load rule");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  function update(key, value) {
    setForm((f) => ({ ...(f || {}), [key]: value }));
    setError("");
  }

  async function submit() {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and Name are required");
      return;
    }

    try {
      setSaving(true);
      await ClaimsApi.updateRule(id, {
        code: form.code.trim(),
        name: form.name.trim(),
        severity: form.severity,
        enabled: form.enabled
      });
      navigate("/rules");
    } catch (e) {
      setError(e.message || "Failed to update rule");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!form) {
    return (
      <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
        <Typography color="error">
          {error || "Rule not found."}
        </Typography>
        <Button sx={{ mt: 2 }} onClick={() => navigate("/rules")}>
          Back to Rules
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Edit Rule
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Update the rule configuration and save changes or cancel to go back.
          </Typography>

          <Stack spacing={2}>
            <TextField
              label="Rule Code"
              helperText="Short machine code, e.g. REQ_POLICY_NO"
              value={form.code}
              onChange={(e) => update("code", e.target.value)}
            />
            <TextField
              label="Name / Description"
              helperText="Human friendly description shown in UI"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />

            <FormControl>
              <Typography variant="caption" sx={{ mb: 0.5 }}>
                Severity
              </Typography>
              <Select
                value={form.severity}
                onChange={(e) => update("severity", e.target.value)}
                size="small"
              >
                <MenuItem value="INFO">INFO</MenuItem>
                <MenuItem value="WARN">WARN</MenuItem>
                <MenuItem value="BLOCK">BLOCK</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                />
              }
              label="Enabled"
            />

            {error && (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button onClick={() => navigate("/rules")} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={submit}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

