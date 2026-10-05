import React from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  LinearProgress,
  Stack,
  Typography
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DescriptionIcon from "@mui/icons-material/Description";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import PolicyIcon from "@mui/icons-material/Policy";
import AnalyticsIcon from "@mui/icons-material/Analytics";

const steps = [
  { label: "Reading claim documents", icon: <DescriptionIcon /> },
  { label: "Checking clinical & policy data", icon: <HealthAndSafetyIcon /> },
  { label: "Validating claim readiness", icon: <FactCheckIcon /> },
  { label: "Reviewing payer & authorization rules", icon: <PolicyIcon /> },
  { label: "Calculating readiness & rejection risk", icon: <AnalyticsIcon /> }
];

export default function AICheckProgress({ open }) {
  const [step, setStep] = React.useState(0);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;

    setStep(0);
    setProgress(5);

    const interval = setInterval(() => {
      setProgress((value) => {
        if (value >= 94) return 94;
        return Math.min(94, value + 3);
      });
    }, 110);

    const stepTimer = setInterval(() => {
      setStep((value) => (value < steps.length - 1 ? value + 1 : value));
    }, 700);

    return () => {
      clearInterval(interval);
      clearInterval(stepTimer);
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 4,
          overflow: "hidden",
          background:
            "linear-gradient(145deg, rgba(255,255,255,1) 0%, rgba(246,250,255,1) 100%)"
        }
      }}
    >
      <DialogContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={3} alignItems="center">
          <Box
            sx={{
              position: "relative",
              width: 112,
              height: 112,
              display: "grid",
              placeItems: "center"
            }}
          >
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "2px dashed",
                borderColor: "primary.light",
                animation: "claimAiSpin 5s linear infinite",
                "@keyframes claimAiSpin": {
                  from: { transform: "rotate(0deg)" },
                  to: { transform: "rotate(360deg)" }
                }
              }}
            />
            <Box
              sx={{
                width: 74,
                height: 74,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                color: "primary.main",
                backgroundColor: "primary.50",
                boxShadow: "0 10px 30px rgba(25,118,210,0.18)",
                animation: "claimAiPulse 1.5s ease-in-out infinite",
                "@keyframes claimAiPulse": {
                  "0%, 100%": { transform: "scale(1)" },
                  "50%": { transform: "scale(1.06)" }
                }
              }}
            >
              <HealthAndSafetyIcon sx={{ fontSize: 38 }} />
            </Box>
            <AutoAwesomeIcon
              sx={{
                position: "absolute",
                top: 5,
                right: 3,
                color: "secondary.main",
                fontSize: 26
              }}
            />
          </Box>

          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h5" fontWeight={800}>
              Checking Claim Readiness
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Reviewing the claim before submission
            </Typography>
          </Box>

          <Stack spacing={1.15} sx={{ width: "100%" }}>
            {steps.map((item, index) => {
              const complete = index < step;
              const active = index === step;
              return (
                <Stack
                  key={item.label}
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  sx={{
                    p: 1.15,
                    borderRadius: 2,
                    backgroundColor: active
                      ? "rgba(25,118,210,0.08)"
                      : "transparent",
                    opacity: index > step ? 0.45 : 1,
                    transition: "all 0.2s ease"
                  }}
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      color: complete || active ? "white" : "text.secondary",
                      backgroundColor: complete
                        ? "success.main"
                        : active
                        ? "primary.main"
                        : "grey.200",
                      "& svg": { fontSize: 18 }
                    }}
                  >
                    {complete ? "✓" : item.icon}
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={active ? 700 : 500}
                    sx={{ flex: 1 }}
                  >
                    {item.label}
                  </Typography>
                  {active && (
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label="Checking"
                    />
                  )}
                </Stack>
              );
            })}
          </Stack>

          <Box sx={{ width: "100%" }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{ height: 9, borderRadius: 99 }}
            />
            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ mt: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary">
                Secure claim analysis
              </Typography>
              <Typography variant="caption" fontWeight={700} color="primary.main">
                {progress}%
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
