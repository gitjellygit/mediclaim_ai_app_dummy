import { Box, List, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import VerifiedIcon from "@mui/icons-material/Verified";
import FolderIcon from "@mui/icons-material/Folder";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import BarChartIcon from "@mui/icons-material/BarChart";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function LeftNav({ width = 240 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  // Helper function to check if a path is active
  function isActivePath(path) {
    return location.pathname.startsWith(path);
  }

  return (
    <Box
      sx={{
        width,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        backgroundColor: "#114aa6",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ p: 2, fontWeight: 600, fontSize: 18 }}>
        Hospital AI Platform
      </Box>

      <List sx={{ flex: 1 }}>
        <NavItem 
          icon={<DescriptionIcon />} 
          label="AI Claims" 
          path="/claims" 
          isActive={isActivePath("/claims")} 
        />
        <NavItem 
          icon={<VerifiedIcon />} 
          label="Medical Consistency" 
          path="/medical-ai" 
          isActive={isActivePath("/medical-ai")} 
        />
        <NavItem 
          icon={<FolderIcon />} 
          label="Document Intelligence" 
          path="/documents" 
          isActive={isActivePath("/documents")} 
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
          <ListItemIcon sx={{ color: "#fff" }}><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Logout" />
        </ListItemButton>
      </Box>
    </Box>
  );

  function NavItem({ icon, label, path, isActive = false }) {
    return (
      <ListItemButton 
        onClick={() => navigate(path)}
        sx={{
          backgroundColor: isActive ? "rgba(255,255,255,0.1)" : "transparent",
          "&:hover": {
            backgroundColor: isActive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"
          }
        }}
      >
        <ListItemIcon sx={{ color: isActive ? "#fff" : "rgba(255,255,255,0.7)" }}>
          {icon}
        </ListItemIcon>
        <ListItemText 
          primary={label} 
          sx={{ 
            color: isActive ? "#fff" : "rgba(255,255,255,0.9)",
            fontWeight: isActive ? 600 : 400
          }} 
        />
      </ListItemButton>
    );
  }
}
