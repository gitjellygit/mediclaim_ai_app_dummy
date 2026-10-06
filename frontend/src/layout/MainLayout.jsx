import React from "react";
import { Outlet } from "react-router-dom";
import { AppBar, Box, IconButton, Toolbar, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import LeftNav from "./LeftNav";

const SIDEBAR_WIDTH = 240;

export default function MainLayout({ children }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "background.default" }}>
      <AppBar
        position="fixed"
        elevation={1}
        sx={{
          display: { xs: "block", md: "none" },
          backgroundColor: "primary.dark",
          zIndex: (theme) => theme.zIndex.drawer + 1
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap>
            PRISM
          </Typography>
        </Toolbar>
      </AppBar>

      <LeftNav
        width={SIDEBAR_WIDTH}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <Box
        component="main"
        sx={{
          minWidth: 0,
          ml: { xs: 0, md: `${SIDEBAR_WIDTH}px` },
          pt: { xs: 8, md: 0 },
          px: { xs: 1.5, sm: 2, md: 2.5 },
          pb: { xs: 2, md: 3 },
          backgroundColor: "#f5f7fb",
          minHeight: "100vh"
        }}
      >
        {children ?? <Outlet />}
      </Box>
    </Box>
  );
}
