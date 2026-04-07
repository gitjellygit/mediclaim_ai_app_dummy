import React from "react";
import { Card, CardContent, Typography } from "@mui/material";

export default function MedicalConsistency() {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5">Medical Consistency Check</Typography>
        <Typography color="text.secondary">
          Diagnosis ↔ ICD ↔ Procedures validation will appear here.
        </Typography>
      </CardContent>
    </Card>
  );
}
