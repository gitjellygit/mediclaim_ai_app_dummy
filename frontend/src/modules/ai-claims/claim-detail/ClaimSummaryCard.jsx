import React from "react";
import { Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { STATUS_COLOR, claimTypeLabel } from "./claimDetailUtils.js";

export default function ClaimSummaryCard({ claim }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h5">{claim.patientName}</Typography>
        <Typography color="text.secondary">
          {claim.hospitalName || "Hospital"} • {claim.payerName}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}
        >
          <Chip label={claim.status} color={STATUS_COLOR[claim.status] || "default"} />
          <Chip label={claimTypeLabel(claim.claimType)} variant="outlined" />
          {claim.documents?.length > 1 && (
            <Chip
              label={`${claim.documents.length} documents consolidated in this claim`}
              color="success"
              variant="outlined"
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
