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
  Button
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";

export default function NewRule() {
  const navigate = useNavigate();
  const [form, setForm] = React.useState({
    code: "",
    name: "",
    severity: "WARN"
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  }

  async function submit() {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and Name are required");
      return;
    }

    try {
      setSaving(true);
      await ClaimsApi.createRule({
        code: form.code.trim(),
        name: form.name.trim(),
        severity: form.severity
      });
      navigate("/rules");
    } catch (e) {
      setError(e.message || "Failed to create rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Add New Rule
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Define a new validation rule that will be applied to claims.
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
                {saving ? "Saving…" : "Create Rule"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

