import React from "react";
import {
  Box,
  Button,
  Divider,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { formatUSD } from "../utils/currency.js";

export function emptyServiceLine() {
  return {
    cptHcpcsCode: "",
    modifiers: "",
    units: "1",
    charge: "",
    diagnosisPointers: "",
    placeOfService: "",
    serviceDateFrom: "",
    serviceDateTo: "",
    revenueCode: "",
    poaIndicator: ""
  };
}

export function serviceLineToForm(line = {}) {
  return {
    cptHcpcsCode: line.cptHcpcsCode || "",
    modifiers: Array.isArray(line.modifiers) ? line.modifiers.join(", ") : (line.modifiers || ""),
    units: line.units != null ? String(line.units) : "1",
    charge: line.charge != null ? String(line.charge) : "",
    diagnosisPointers: Array.isArray(line.diagnosisPointers)
      ? line.diagnosisPointers.join(", ")
      : (line.diagnosisPointers || ""),
    placeOfService: line.placeOfService || "",
    serviceDateFrom: line.serviceDateFrom
      ? new Date(line.serviceDateFrom).toISOString().slice(0, 10)
      : "",
    serviceDateTo: line.serviceDateTo
      ? new Date(line.serviceDateTo).toISOString().slice(0, 10)
      : "",
    revenueCode: line.revenueCode || "",
    poaIndicator: line.poaIndicator || ""
  };
}

export function serviceLineToPayload(line = {}) {
  return {
    cptHcpcsCode: line.cptHcpcsCode?.trim(),
    modifiers: String(line.modifiers || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    units: line.units === "" ? null : Number(line.units),
    charge: line.charge === "" ? null : Number(line.charge),
    diagnosisPointers: String(line.diagnosisPointers || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    placeOfService: line.placeOfService?.trim() || null,
    serviceDateFrom: line.serviceDateFrom || null,
    serviceDateTo: line.serviceDateTo || null,
    revenueCode: line.revenueCode?.trim() || null,
    poaIndicator: line.poaIndicator?.trim() || null
  };
}

export default function ServiceLinesEditor({
  lines = [],
  onChange,
  readOnly = false
}) {
  if (readOnly) {
    if (!lines.length) {
      return (
        <Typography color="text.secondary">
          No service lines recorded.
        </Typography>
      );
    }

    return (
      <Stack spacing={1.5}>
        {lines.map((line, index) => (
          <Box key={line.id || `${line.cptHcpcsCode}-${index}`} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <Typography fontWeight={600}>
              {index + 1}. {line.cptHcpcsCode}
              {line.modifiers?.length ? `-${line.modifiers.join("-")}` : ""}
            </Typography>
            <Typography variant="body2">
              Units: {line.units ?? "—"} | Charge: {formatUSD(line.charge)}
              {line.placeOfService ? ` | POS: ${line.placeOfService}` : ""}
            </Typography>
            <Typography variant="body2">
              Diagnosis pointers: {line.diagnosisPointers?.length ? line.diagnosisPointers.join(", ") : "—"}
              {line.revenueCode ? ` | Revenue: ${line.revenueCode}` : ""}
              {line.poaIndicator ? ` | POA: ${line.poaIndicator}` : ""}
            </Typography>
          </Box>
        ))}
      </Stack>
    );
  }

  const updateLine = (index, key, value) => {
    onChange(lines.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [key]: value } : line
    ));
  };

  const removeLine = (index) => {
    onChange(lines.filter((_, lineIndex) => lineIndex !== index));
  };

  return (
    <Stack spacing={2}>
      {lines.map((line, index) => (
        <Box key={index} sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography fontWeight={600}>Service Line {index + 1}</Typography>
            <Button size="small" color="error" onClick={() => removeLine(index)}>
              Remove
            </Button>
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
            <TextField
              label="CPT / HCPCS"
              value={line.cptHcpcsCode}
              onChange={(event) => updateLine(index, "cptHcpcsCode", event.target.value)}
            />
            <TextField
              label="Modifiers (comma separated)"
              value={line.modifiers}
              onChange={(event) => updateLine(index, "modifiers", event.target.value)}
            />
            <TextField
              label="Units"
              type="number"
              inputProps={{ min: 0, step: "0.01" }}
              value={line.units}
              onChange={(event) => updateLine(index, "units", event.target.value)}
            />
            <TextField
              label="Charge (USD)"
              type="number"
              inputProps={{ min: 0, step: "0.01" }}
              value={line.charge}
              onChange={(event) => updateLine(index, "charge", event.target.value)}
            />
            <TextField
              label="Diagnosis Pointers"
              value={line.diagnosisPointers}
              onChange={(event) => updateLine(index, "diagnosisPointers", event.target.value)}
              helperText="ICD-10-CM codes or line pointers, comma separated"
            />
            <TextField
              label="Place of Service"
              value={line.placeOfService}
              onChange={(event) => updateLine(index, "placeOfService", event.target.value)}
            />
            <TextField
              label="Service Date From"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={line.serviceDateFrom}
              onChange={(event) => updateLine(index, "serviceDateFrom", event.target.value)}
            />
            <TextField
              label="Service Date To"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={line.serviceDateTo}
              onChange={(event) => updateLine(index, "serviceDateTo", event.target.value)}
            />
            <TextField
              label="Revenue Code"
              value={line.revenueCode}
              onChange={(event) => updateLine(index, "revenueCode", event.target.value)}
            />
            <TextField
              label="POA Indicator"
              value={line.poaIndicator}
              onChange={(event) => updateLine(index, "poaIndicator", event.target.value)}
            />
          </Box>
        </Box>
      ))}

      <Divider />
      <Button
        variant="outlined"
        onClick={() => onChange([...lines, emptyServiceLine()])}
        sx={{ alignSelf: "flex-start" }}
      >
        Add Service Line
      </Button>
    </Stack>
  );
}
