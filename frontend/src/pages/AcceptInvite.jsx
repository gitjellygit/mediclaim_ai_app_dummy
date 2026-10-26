import React from "react";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token, setToken] = React.useState(params.get("token") || "");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState(false);

  async function submit() {
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    try {
      await api("/api/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ setupToken: token.trim(), password })
      });
      setDone(true);
    } catch (e) {
      setError(e?.message || "Invitation could not be accepted.");
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2, bgcolor: "background.default" }}>
      <Paper sx={{ width: "100%", maxWidth: 460, p: 2.5 }}>
        <Typography variant="h5" fontWeight={850}>Activate PRISM Account</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use your one-time setup token and choose your own password.
        </Typography>

        {done ? (
          <Stack spacing={1.5}>
            <Alert severity="success">Account activated successfully.</Alert>
            <Button variant="contained" onClick={() => navigate("/login")}>Go to Sign In</Button>
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Setup Token" value={token} onChange={(e) => setToken(e.target.value)} />
            <TextField label="New Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <TextField label="Confirm Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button variant="contained" onClick={submit} disabled={!token.trim() || !password || !confirm}>Activate Account</Button>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
