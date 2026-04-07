import React from "react";
import { Card, CardContent, Typography } from "@mui/material";

export default function AnalyticsDashboard() {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5">Analytics & Insights</Typography>
        <Typography color="text.secondary">
          Claims funnel, insurer performance, trends.
        </Typography>
      </CardContent>
    </Card>
  );
}
