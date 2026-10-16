import React from "react";
import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import RuleForm from "./RuleForm.jsx";

export default function NewRule() {
  const navigate = useNavigate();
  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: 3 }}>
      <RuleForm
        onSaved={() => navigate("/rules")}
        onCancel={() => navigate("/rules")}
      />
    </Box>
  );
}
