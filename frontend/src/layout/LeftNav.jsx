import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import VerifiedIcon from "@mui/icons-material/Verified";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import BarChartIcon from "@mui/icons-material/BarChart";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function LeftNav({
  width = 240,
  mobileOpen = false,
  onMobileClose = () => {}
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

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
          backgroundColor: isActive ? "rgba(255,255,255,0.1)" : "transparent",
          "&:hover": {
            backgroundColor: isActive
              ? "rgba(255,255,255,0.2)"
              : "rgba(255,255,255,0.05)"
          }
        }}
      >
        <ListItemIcon
          sx={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
            minWidth: 44
          }}
        >
          {icon}
        </ListItemIcon>
        <ListItemText
          primary={label}
          primaryTypographyProps={{ noWrap: true }}
          sx={{
            color: isActive ? "#fff" : "rgba(255,255,255,0.9)",
            fontWeight: isActive ? 600 : 400
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
        backgroundColor: "#114aa6",
        color: "#fff",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <Box sx={{ p: 2, fontWeight: 600, fontSize: 18 }}>
        Hospital AI Platform
      </Box>

      <List sx={{ flex: 1, overflowY: "auto" }}>
        <NavItem
          icon={<DescriptionIcon />}
          label="AI Claims"
          path="/claims"
          isActive={isActivePath("/claims")}
        />
        <NavItem
          icon={<AccountTreeIcon />}
          label="Claim Journey"
          path="/journey"
          isActive={isActivePath("/journey")}
        />
        <NavItem
          icon={<ReportProblemIcon />}
          label="Denial Intelligence"
          path="/denials"
          isActive={isActivePath("/denials")}
        />
        <NavItem
          icon={<VerifiedIcon />}
          label="Medical Consistency"
          path="/medical-ai"
          isActive={isActivePath("/medical-ai")}
        />
        <NavItem
          icon={<MonetizationOnIcon />}
          label="Approval Intelligence"
          path="/approval"
          isActive={isActivePath("/approval")}
        />
        <NavItem
          icon={<BarChartIcon />}
          label="Analytics"
          path="/analytics"
          isActive={isActivePath("/analytics")}
        />
        <NavItem
          icon={<SettingsIcon />}
          label="Rules"
          path="/rules"
          isActive={isActivePath("/rules")}
        />
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
