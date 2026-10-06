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
import {
  AutoAwesome,
  Calculate,
  ExpandLess,
  ExpandMore,
  FactCheck,
  Person
} from "@mui/icons-material";
import { provenanceChipColor } from "./claimDetailUtils.js";

export default function ClaimAutomationCard({
  summary,
  onFieldAction,
  actionLabel
}) {
  const [sectionExpanded, setSectionExpanded] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [filter, setFilter] = React.useState("all");

  if (!summary) return null;

  function showBucket(bucket) {
    setSectionExpanded(true);
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
            <Stack direction="row" spacing={1} alignItems="center">
              <AutoAwesome color="secondary" />
              <Typography variant="h6" fontWeight={700}>
                Claim Automation
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Shows what the system populated automatically, what staff entered,
              and what still needs review.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              icon={<AutoAwesome />}
              color="success"
              clickable
              onClick={() => showBucket("automated")}
              label={`${summary.automatedFields} auto-populated`}
            />
            <Chip
              icon={<FactCheck />}
              color="warning"
              clickable
              onClick={() => showBucket("review")}
              label={`${summary.reviewFields} need review`}
            />
            <Chip
              icon={<Person />}
              variant="outlined"
              clickable
              onClick={() => showBucket("manual")}
              label={`${summary.manualFields} manual`}
            />
            <Chip
              icon={<Calculate />}
              color={summary.missingFields ? "error" : "default"}
              variant={summary.missingFields ? "filled" : "outlined"}
              clickable
              onClick={() => showBucket("missing")}
              label={`${summary.missingFields} missing`}
            />
          </Stack>

          <Button
            size="small"
            variant="text"
            endIcon={sectionExpanded ? <ExpandLess /> : <ExpandMore />}
            onClick={() => setSectionExpanded((value) => !value)}
            sx={{ flexShrink: 0 }}
          >
            {sectionExpanded ? "Collapse" : "Expand"}
          </Button>
        </Stack>

        <Collapse in={sectionExpanded}>
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" fontWeight={600}>
              Automation rate: {summary.automationRate}% of currently populated tracked fields
            </Typography>
            <Button
              size="small"
              onClick={() => {
                setFilter("all");
                setExpanded((value) => !value);
              }}
            >
              {expanded ? "Hide Field Sources" : "View Field Sources"}
            </Button>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={summary.automationRate}
            color={
              summary.automationRate >= 70
                ? "success"
                : summary.automationRate >= 40
                ? "warning"
                : "primary"
            }
            sx={{ mt: 1, height: 8, borderRadius: 4 }}
          />
        </Box>

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
                ? "Missing fields — click a field to complete it"
                : filter === "review"
                ? "Fields needing review — click a field to resolve it"
                : filter === "manual"
                ? "Manually entered fields"
                : filter === "automated"
                ? "Auto-populated fields and their sources"
                : "All tracked fields"}
            </Typography>
            {filter !== "all" && (
              <Button size="small" variant="text" onClick={() => setFilter("all")}>
                Show all fields
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
            {(summary.fields || [])
              .filter((item) => filter === "all" || item.bucket === filter)
              .map((item) => {
                const actionable = ["missing", "review"].includes(item.bucket);
                return (
                  <Paper
                    key={item.field}
                    variant="outlined"
                    onClick={() => actionable && onFieldAction(item)}
                    sx={{
                      p: 1.25,
                      cursor: actionable ? "pointer" : "default",
                      transition: "all 0.15s ease",
                      "&:hover": actionable
                        ? {
                            borderColor:
                              item.bucket === "missing"
                                ? "error.main"
                                : "warning.main",
                            boxShadow: 2,
                            transform: "translateY(-1px)"
                          }
                        : undefined
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      spacing={1}
                    >
                      <Typography variant="body2" fontWeight={600}>
                        {item.label}
                      </Typography>
                      {actionable && (
                        <Button
                          size="small"
                          variant="text"
                          color={item.bucket === "missing" ? "error" : "warning"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onFieldAction(item);
                          }}
                        >
                          {actionLabel(item)}
                        </Button>
                      )}
                    </Stack>

                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap">
                      <Chip
                        size="small"
                        label={
                          item.bucket === "automated"
                            ? "Auto-populated"
                            : item.bucket === "manual"
                            ? "Manual"
                            : item.bucket === "review"
                            ? "Needs Review"
                            : "Missing"
                        }
                        color={
                          item.bucket === "automated"
                            ? "success"
                            : item.bucket === "review"
                            ? "warning"
                            : item.bucket === "missing"
                            ? "error"
                            : "default"
                        }
                        variant={item.bucket === "manual" ? "outlined" : "filled"}
                      />
                      {item.source && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={provenanceChipColor(item.source.source)}
                          label={
                            item.source.confidence != null
                              ? `${item.source.label} • ${item.source.confidence}%`
                              : item.source.label
                          }
                        />
                      )}
                    </Stack>
                  </Paper>
                );
              })}
          </Box>
        </Collapse>
        </Collapse>
      </CardContent>
    </Card>
  );
}
