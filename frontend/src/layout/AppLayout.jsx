import React from "react";
import { Box } from "@mui/material";
import LeftNav from "./LeftNav.jsx";
import TopNav from "../components/TopNav.jsx";

export default function AppLayout({ current, onNavigate, children }) {
  return (
    <Box sx={{ display: "flex" }}>
      <LeftNav current={current} onNavigate={onNavigate} />

      <Box sx={{ ml: "260px", flex: 1 }}>
        <TopNav current={current} onGo={onNavigate} />
        <Box sx={{ p: 3 }}>{children}</Box>
      </Box>
    </Box>
  );
}
