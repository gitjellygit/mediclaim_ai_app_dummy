import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import BarChartIcon from "@mui/icons-material/BarChart";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { hasPermission, PERMISSIONS } from "../security/permissions.js";

export default function LeftNav({
  width = 240,
  mobileOpen = false,
  onMobileClose = () => {}
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function isActivePath(path) {
    return location.pathname.startsWith(path);
  }

  function go(path) {
    navigate(path);
    onMobileClose();
  }

  function NavItem({ icon, label, path, isActive = false }) {
    return (
      <ListItemButton
        onClick={() => go(path)}
        sx={{
          mx: 1,
          my: 0.25,
          px: 1.25,
          minHeight: 42,
          borderRadius: 1,
          backgroundColor: isActive ? "rgba(255,255,255,0.12)" : "transparent",
          "&:hover": {
            backgroundColor: isActive
              ? "rgba(255,255,255,0.16)"
              : "rgba(255,255,255,0.06)"
          }
        }}
      >
        <ListItemIcon
          sx={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
            minWidth: 38
          }}
        >
          {icon}
        </ListItemIcon>
        <ListItemText
          primary={label}
          primaryTypographyProps={{
            noWrap: true,
            fontSize: 13.5,
            fontWeight: isActive ? 650 : 450
          }}
          sx={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.82)"
          }}
        />
      </ListItemButton>
    );
  }

  const content = (
    <Box
      sx={{
        width,
        height: "100%",
        backgroundColor: "#102F47",
        color: "#fff",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 2.1,
          borderBottom: "1px solid rgba(255,255,255,0.08)"
        }}
      >
        <Box sx={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.08em" }}>
          PRISM
        </Box>
        <Box
          sx={{
            mt: 0.25,
            fontSize: 10.5,
            lineHeight: 1.35,
            letterSpacing: "0.045em",
            color: "rgba(255,255,255,0.62)",
            textTransform: "uppercase"
          }}
        >
          Payer & Revenue Intelligence
        </Box>
      </Box>

      <List sx={{ flex: 1, overflowY: "auto" }}>
        {hasPermission(user, PERMISSIONS.CLAIM_VIEW) && (
          <NavItem
            icon={<DescriptionIcon />}
            label="Claims"
            path="/claims"
            isActive={isActivePath("/claims")}
          />
        )}
        {hasPermission(user, PERMISSIONS.INSURANCE_VIEW) && (
          <NavItem
            icon={<AccountTreeIcon />}
            label="Claim Journey"
            path="/journey"
            isActive={isActivePath("/journey")}
          />
        )}
        {hasPermission(user, PERMISSIONS.DENIAL_VIEW) && (
          <NavItem
            icon={<ReportProblemIcon />}
            label="Denial Intelligence"
            path="/denials"
            isActive={isActivePath("/denials")}
          />
        )}
        {hasPermission(user, PERMISSIONS.FINANCIAL_VIEW) && (
          <NavItem
            icon={<AccountBalanceWalletIcon />}
            label="Payment Variance"
            path="/payments"
            isActive={isActivePath("/payments")}
          />
        )}
        {hasPermission(user, PERMISSIONS.CLINICAL_VIEW) && (
          <NavItem
            icon={<MonetizationOnIcon />}
            label="Approval Intelligence"
            path="/approval"
            isActive={isActivePath("/approval")}
          />
        )}
        {hasPermission(user, PERMISSIONS.FINANCIAL_VIEW) && (
          <NavItem
            icon={<BarChartIcon />}
            label="Analytics"
            path="/analytics"
            isActive={isActivePath("/analytics")}
          />
        )}
        {hasPermission(user, PERMISSIONS.AUDIT_VIEW) && (
          <NavItem
            icon={<FactCheckIcon />}
            label="Audit Trail"
            path="/audit"
            isActive={isActivePath("/audit")}
          />
        )}
        {user?.role === "ADMIN" && (
          <NavItem
            icon={<SettingsIcon />}
            label="Rules"
            path="/rules"
            isActive={isActivePath("/rules")}
          />
        )}
      </List>

      <Box sx={{ p: 1, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
        <ListItemButton onClick={handleLogout} sx={{ borderRadius: 1 }}>
          <ListItemIcon sx={{ color: "#fff", minWidth: 44 }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary="Logout" />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <>
      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: "none", md: "block" },
          "& .MuiDrawer-paper": {
            width,
            boxSizing: "border-box",
            borderRight: 0
          }
        }}
      >
        {content}
      </Drawer>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": {
            width: Math.min(width, 280),
            boxSizing: "border-box",
            borderRight: 0
          }
        }}
      >
        {content}
      </Drawer>
    </>
  );
}
