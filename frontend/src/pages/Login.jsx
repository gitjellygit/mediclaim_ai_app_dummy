import React from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  Alert
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { AuthApi } from "../api/auth.js";
import { useToast } from "../context/ToastContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, login, loading: authLoading } = useAuth();

  const [email, setEmail] = React.useState("admin@hospital.com");
  const [password, setPassword] = React.useState("admin123");
  const [loading, setLoading] = React.useState(false);
  const [lockoutError, setLockoutError] = React.useState(null);
  const [resetting, setResetting] = React.useState(false);
  const [pendingRedirect, setPendingRedirect] = React.useState(false);

  React.useEffect(() => {
    if (pendingRedirect && user && !authLoading) {
      setPendingRedirect(false);
      navigate("/claims", { replace: true });
    }
  }, [pendingRedirect, user, authLoading, navigate]);

  // Redirect already logged-in users
  React.useEffect(() => {
    if (user && !authLoading && !pendingRedirect) {
      navigate("/claims", { replace: true });
    }
  }, [user, authLoading, navigate, pendingRedirect]);

  async function submit() {
    try {
      setLoading(true);
      setLockoutError(null);
      const res = await AuthApi.login(email, password);
      if (!res?.user) throw new Error("No user in response");

      login(res.user);
      showToast("Login successful", "success");
      setPendingRedirect(true);
    } catch (e) {
      const errorMessage = e.message || "Login failed";
      const isLockoutError =
        e.status === 429 ||
        e.status === 423 ||
        /too many|locked|attempts|rate limit|429|423/i.test(errorMessage);
      if (isLockoutError) setLockoutError(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetLockout() {
    try {
      setResetting(true);
      await AuthApi.resetLockout(email);
      setLockoutError(null);
      showToast("Account unlocked. You can try logging in again.", "success");
    } catch (e) {
      showToast(e.message || "Failed to reset lockout", "error");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Card sx={{ width: 420 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Login
          </Typography>

          <Stack spacing={2}>
            {lockoutError && (
              <Alert 
                severity="warning"
                action={
                  <Button
                    size="small"
                    onClick={handleResetLockout}
                    disabled={resetting}
                    color="inherit"
                  >
                    {resetting ? "Resetting..." : "Reset"}
                  </Button>
                }
              >
                {lockoutError}
              </Alert>
            )}

            <TextField
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading || resetting}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !loading && !resetting) {
                  submit();
                }
              }}
            />

            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || resetting}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !loading && !resetting) {
                  submit();
                }
              }}
            />

            <Button
              variant="contained"
              onClick={submit}
              disabled={loading || resetting}
              fullWidth
              size="large"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            <Button
              variant="outlined"
              onClick={(e) => { e.preventDefault(); handleResetLockout(); }}
              disabled={resetting || loading}
              fullWidth
              size="small"
              color="warning"
              sx={{ mt: 1 }}
            >
              {resetting ? "Resetting Lockout..." : "Reset Account Lockout"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
