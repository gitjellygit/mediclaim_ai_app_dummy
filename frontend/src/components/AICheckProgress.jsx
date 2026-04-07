import React from "react";
import {
  Dialog,
  DialogContent,
  Typography,
  LinearProgress,
  Stack,
  Box
} from "@mui/material";
import PsychologyIcon from "@mui/icons-material/Psychology";

const steps = [
  "Reading uploaded documents",
  "Extracting medical & policy details",
  "Validating diagnosis and procedures",
  "Checking insurance rules",
  "Calculating claim readiness score"
];

export default function AICheckProgress({ open }) {
  const [step, setStep] = React.useState(0);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;

    setStep(0);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 100;
        return p + 2;
      });
    }, 60);

    const stepTimer = setInterval(() => {
      setStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, 1200);

    return () => {
      clearInterval(interval);
      clearInterval(stepTimer);
    };
  }, [open]);

  return (
    <Dialog open={open} maxWidth="sm" fullWidth>
      <DialogContent>
        <Stack spacing={3} alignItems="center">
          <PsychologyIcon color="primary" sx={{ fontSize: 48 }} />

          <Typography variant="h6">
            AI Claim Analysis in Progress
          </Typography>

          <Box sx={{ width: "100%" }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{ height: 10, borderRadius: 5 }}
            />
          </Box>

          <Typography color="text.secondary">
            {steps[step]}
          </Typography>

          <Typography variant="caption" color="text.secondary">
            Please wait while we analyze the claim…
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
