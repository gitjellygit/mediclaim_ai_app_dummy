import React from "react";
import { Card, CardContent, Typography } from "@mui/material";

export default function ApprovalIntelligence() {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5">Approval Intelligence</Typography>
        <Typography color="text.secondary">
          Expected approval amount, rejection risk, suggestions.
        </Typography>
      </CardContent>
    </Card>
  );
}
