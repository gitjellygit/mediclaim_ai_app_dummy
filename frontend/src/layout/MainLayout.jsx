import { Box } from "@mui/material";
import LeftNav from "./LeftNav";

const SIDEBAR_WIDTH = 240;

export default function MainLayout({ children }) {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Left Navigation */}
      <LeftNav width={SIDEBAR_WIDTH} />

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: `${SIDEBAR_WIDTH}px`,
          p: 3,
          backgroundColor: "#f5f7fb",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
