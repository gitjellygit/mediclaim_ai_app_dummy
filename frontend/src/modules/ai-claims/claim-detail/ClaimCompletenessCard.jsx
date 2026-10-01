import React from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography
} from "@mui/material";

export default function ClaimCompletenessCard({ completeness, onFixItem }) {
  const [expanded, setExpanded] = React.useState(false);
  const [filter, setFilter] = React.useState("all");

  if (!completeness) return null;

  function showBucket(bucket) {
    setFilter(bucket);
    setExpanded(true);
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={2}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Claim Completeness
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Context-aware: only fields applicable to this encounter count against completeness.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip
              color={
                completeness.score >= 90
                  ? "success"
                  : completeness.score >= 70
                  ? "warning"
                  : "error"
              }
              label={`${completeness.score}% complete`}
            />
            <Chip
              clickable
              color={completeness.missingFields ? "error" : "default"}
              onClick={() => showBucket("missing")}
              label={`${completeness.missingFields} missing`}
            />
            <Chip
              clickable
              color={completeness.reviewFields ? "warning" : "default"}
              onClick={() => showBucket("review")}
              label={`${completeness.reviewFields} need review`}
            />
            <Chip
              clickable
              variant="outlined"
              onClick={() => showBucket("not_applicable")}
              label={`${completeness.notApplicableFields} N/A`}
            />
          </Stack>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={completeness.score}
          color={
            completeness.score >= 90
              ? "success"
              : completeness.score >= 70
              ? "warning"
              : "error"
          }
          sx={{ mt: 2, height: 8, borderRadius: 4 }}
        />

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {completeness.completeFields} of {completeness.applicableFields} applicable fields complete
          </Typography>
          <Button
            size="small"
            onClick={() => {
              setFilter("all");
              setExpanded((value) => !value);
            }}
          >
            {expanded ? "Hide Details" : "View Details"}
          </Button>
        </Stack>

        <Collapse in={expanded}>
          <Divider sx={{ my: 2 }} />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            spacing={1}
            sx={{ mb: 1.5 }}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              {filter === "missing"
                ? "Missing required fields"
                : filter === "review"
                ? "Applicable fields needing review"
                : filter === "not_applicable"
                ? "Fields not applicable to this encounter"
                : "All completeness fields"}
            </Typography>
            {filter !== "all" && (
              <Button size="small" onClick={() => setFilter("all")}>
                Show all
              </Button>
            )}
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(3, minmax(0, 1fr))"
              },
              gap: 1
            }}
          >
            {(completeness.fields || [])
              .filter((item) => filter === "all" || item.state === filter)
              .map((item) => (
                <Paper
                  key={item.field}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderColor:
                      item.state === "missing"
                        ? "error.light"
                        : item.state === "review"
                        ? "warning.light"
                        : undefined
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>
                        {item.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.reason || (item.conditional ? "Conditional" : "Applicable")}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      color={
                        item.state === "complete"
                          ? "success"
                          : item.state === "missing"
                          ? "error"
                          : item.state === "review"
                          ? "warning"
                          : "info"
                      }
                      variant={item.state === "not_applicable" ? "outlined" : "filled"}
                      label={
                        item.state === "complete"
                          ? "Complete"
                          : item.state === "missing"
                          ? "Missing"
                          : item.state === "review"
                          ? "Review"
                          : "N/A"
                      }
                    />
                  </Stack>

                  {["missing", "review"].includes(item.state) && (
                    <Button size="small" sx={{ mt: 1 }} onClick={() => onFixItem(item)}>
                      Fix
                    </Button>
                  )}
                </Paper>
              ))}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
