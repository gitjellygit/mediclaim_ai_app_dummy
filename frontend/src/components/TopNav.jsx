import React from "react";
import { AppBar, Toolbar, Typography, Button, Stack, Avatar, Chip } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function TopNav({ current, onGo }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function handleLogout() {
    if (!confirm("Logout?")) return;
    await logout();
    navigate("/login", { replace: true });
  }

  const isAdmin = user?.role === "ADMIN";

  return (
    <AppBar position="static" sx={{ background: "linear-gradient(90deg, #1565c0, #1976d2)" }}>
      <Toolbar sx={{ justifyContent: "space-between" }}>
        <Typography variant="h6" sx={{ cursor: "pointer" }} onClick={() => onGo("claims")}>
          Claim AI
        </Typography>

        <Stack direction="row" spacing={2}>
          <Button color="inherit" variant={current === "claims" ? "outlined" : "text"} onClick={() => onGo("claims")}>
            Claims
          </Button>

          {isAdmin && (
            <Button color="inherit" variant={current === "rules" ? "outlined" : "text"} onClick={() => onGo("rules")}>
              Rules
            </Button>
          )}
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar sx={{ bgcolor: "#0d47a1" }}>{(user?.email?.[0] || "U").toUpperCase()}</Avatar>
          <Chip label={user?.role || "—"} size="small" sx={{ bgcolor: "rgba(255,255,255,0.15)", color: "white" }} />
          <Button color="inherit" startIcon={<LogoutIcon />} onClick={handleLogout}>
            Logout
          </Button>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
