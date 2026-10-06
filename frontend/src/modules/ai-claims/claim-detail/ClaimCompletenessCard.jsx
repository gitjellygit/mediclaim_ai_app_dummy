import React from "react";
import { AutoAwesome, ExpandLess, ExpandMore } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  LinearProgress,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import { provenanceChipColor } from "./claimDetailUtils.js";

export default function ClaimCompletenessCard({
  completeness,
  automation,
  onFixItem,
  claimStatus
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [filter, setFilter] = React.useState("attention");

  if (!completeness) return null;

  const claimLocked = ["SUBMITTED", "DENIED", "PAID"].includes(claimStatus || "");
  const automationByField = new Map(
    (automation?.fields || []).map((item) => [item.field, item])
  );

  const autoFilledFields = (completeness.fields || []).filter((item) => {
    if (item.state !== "complete") return false;
    return automationByField.get(item.field)?.bucket === "automated";
  });

  const attentionFields = (completeness.fields || []).filter((item) =>
    ["missing", "review"].includes(item.state)
  );

  function showFilter(next) {
    setFilter(next);
    setExpanded(true);
  }

  function actionMeta(item) {
    if (item.fixTarget === "eligibility") {
      return {
        label: "Go to Eligibility",
        note: "Resolve this in Claim Journey."
      };
    }
    if (item.fixTarget === "prior-auth") {
      return {
        label: "Go to Prior Auth",
        note: "Resolve this in Claim Journey."
      };
    }
    if (item.fixTarget === "coding-review") {
      return {
        label: "Review codes",
        note: "A document-derived code is waiting for Accept, Change, or Reject."
      };
    }
    if (item.fixTarget === "serviceLines") {
      return {
        label: "Edit service line",
        note: null
      };
    }
    return {
      label: "Fix",
      note: claimLocked
        ? "Reopen or amend the claim before changing this field."
        : null
    };
  }

  const visibleFields =
    filter === "missing"
      ? (completeness.fields || []).filter((item) => item.state === "missing")
      : filter === "review"
      ? (completeness.fields || []).filter((item) => item.state === "review")
      : filter === "automated"
      ? autoFilledFields
      : attentionFields;

  return (
    <Card sx={{ mb: 3 }} data-testid="claim-completeness-card">
      <CardContent>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={2}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Claim Completion
            </Typography>
            <Typography variant="body2" color="text.secondary">
              One view of what is complete, missing, auto-filled, or waiting for review.
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
              icon={<AutoAwesome />}
              variant="outlined"
              clickable={autoFilledFields.length > 0}
              onClick={() => autoFilledFields.length && showFilter("automated")}
              label={`${autoFilledFields.length} auto-filled`}
            />
            <Chip
              clickable={completeness.missingFields > 0}
              color={completeness.missingFields ? "error" : "default"}
              variant={completeness.missingFields ? "filled" : "outlined"}
              onClick={() => completeness.missingFields && showFilter("missing")}
              label={`${completeness.missingFields} missing`}
            />
            <Chip
              clickable={completeness.reviewFields > 0}
              color={completeness.reviewFields ? "warning" : "default"}
              variant={completeness.reviewFields ? "filled" : "outlined"}
              onClick={() => completeness.reviewFields && showFilter("review")}
              label={`${completeness.reviewFields} need review`}
            />
          </Stack>

          <Button
            size="small"
            variant="text"
            endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
            onClick={() => {
              if (!expanded) setFilter("attention");
              setExpanded((value) => !value);
            }}
            sx={{ flexShrink: 0 }}
          >
            {expanded ? "Collapse" : "Expand"}
          </Button>
        </Stack>

        <Collapse in={expanded}>
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

          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            spacing={1}
            sx={{ mt: 1.25, mb: 1.25 }}
          >
            <Typography variant="caption" color="text.secondary">
              {completeness.completeFields} of {completeness.applicableFields} applicable fields complete
            </Typography>

            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {filter !== "attention" && (
                <Button size="small" onClick={() => setFilter("attention")}>
                  Needs attention
                </Button>
              )}
              {completeness.missingFields > 0 && (
                <Button size="small" onClick={() => setFilter("missing")}>
                  Missing
                </Button>
              )}
              {completeness.reviewFields > 0 && (
                <Button size="small" onClick={() => setFilter("review")}>
                  Review
                </Button>
              )}
              {autoFilledFields.length > 0 && (
                <Button size="small" onClick={() => setFilter("automated")}>
                  Auto-filled
                </Button>
              )}
            </Stack>
          </Stack>

          {visibleFields.length === 0 ? (
            <Typography variant="body2" color="success.main" fontWeight={700}>
              No fields need attention.
            </Typography>
          ) : (
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
              {visibleFields.map((item) => {
                const automationItem = automationByField.get(item.field);
                const actionable = ["missing", "review"].includes(item.state);
                const action = actionMeta(item);

                return (
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
                        {(item.reason || action.note) && (
                          <Typography variant="caption" color="text.secondary">
                            {item.reason || action.note}
                          </Typography>
                        )}
                      </Box>
                      <Chip
                        size="small"
                        variant={item.state === "complete" ? "outlined" : "filled"}
                        color={
                          item.state === "missing"
                            ? "error"
                            : item.state === "review"
                            ? "warning"
                            : automationItem?.bucket === "automated"
                            ? "success"
                            : "default"
                        }
                        label={
                          item.state === "missing"
                            ? "Missing"
                            : item.state === "review"
                            ? "Needs review"
                            : automationItem?.bucket === "automated"
                            ? "Auto-filled"
                            : "Complete"
                        }
                      />
                    </Stack>

                    {automationItem?.source && item.state === "complete" && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color={provenanceChipColor(automationItem.source.source)}
                        label={automationItem.source.label || automationItem.source.source}
                        sx={{ mt: 0.75 }}
                      />
                    )}

                    {actionable && !claimLocked && (
                      <Button
                        size="small"
                        sx={{ mt: 0.75 }}
                        onClick={() => onFixItem(item)}
                      >
                        {action.label}
                      </Button>
                    )}
                  </Paper>
                );
              })}
            </Box>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
}
