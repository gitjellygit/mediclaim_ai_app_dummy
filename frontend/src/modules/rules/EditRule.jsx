import React from "react";
import { Alert, Box, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import RuleForm from "./RuleForm.jsx";

export default function EditRule() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rule, setRule] = React.useState(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    ClaimsApi.getRule(id)
      .then(setRule)
      .catch((e) => setError(e?.message || "Rule could not be loaded."));
  }, [id]);

  if (error) return <Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box>;
  if (!rule) return <Box sx={{ p: 6, textAlign: "center" }}><CircularProgress /></Box>;

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: 3 }}>
      <RuleForm
        rule={rule}
        onSaved={() => navigate("/rules")}
        onCancel={() => navigate("/rules")}
      />
    </Box>
  );
}
