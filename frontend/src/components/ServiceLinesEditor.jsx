import React from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
  MenuItem
} from "@mui/material";
import { formatUSD } from "../utils/currency.js";
import { toDateInputValue } from "../utils/dateOnly.js";
import {
  POA_OPTIONS,
  POS_OPTIONS,
  cptHcpcsError,
  modifiersError,
  normalizeIcd10Cm,
  normalizeProcedureCode,
  revenueCodeError
} from "../utils/usClaimValidation.js";

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
    poaIndicator: "",
    verified: true,
    source: "USER",
    sourceDocumentId: null
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
    serviceDateFrom: toDateInputValue(line.serviceDateFrom),
    serviceDateTo: toDateInputValue(line.serviceDateTo),
    revenueCode: line.revenueCode || "",
    poaIndicator: line.poaIndicator || "",
    verified: line.verified ?? true,
    source: line.source || "USER",
    sourceDocumentId: line.sourceDocumentId || null
  };
}

export function serviceLineToPayload(line = {}) {
  return {
    cptHcpcsCode: normalizeProcedureCode(line.cptHcpcsCode),
    modifiers: String(line.modifiers || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    units: line.units === "" ? null : Number(line.units),
    charge: line.charge === "" ? null : Number(line.charge),
    diagnosisPointers: String(line.diagnosisPointers || "")
      .split(",")
      .map((value) => normalizeIcd10Cm(value))
      .filter(Boolean),
    placeOfService: line.placeOfService?.trim() || null,
    serviceDateFrom: line.serviceDateFrom || null,
    serviceDateTo: line.serviceDateTo || null,
    revenueCode: line.revenueCode?.trim() || null,
    poaIndicator: line.poaIndicator?.trim() || null,
    verified: line.source === "DOCUMENT_OCR" ? Boolean(line.verified) : true,
    source: line.source === "DOCUMENT_OCR" ? "DOCUMENT_OCR" : "USER",
    sourceDocumentId:
      line.source === "DOCUMENT_OCR" ? (line.sourceDocumentId || null) : null
  };
}

export default function ServiceLinesEditor({
  lines = [],
  onChange,
  readOnly = false,
  highlightField = "",
  claimForm = "",
  diagnosisCodes = []
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

  const isHighlighted = (field) =>
    highlightField === "serviceLines" || highlightField === field;

  const normalizedDiagnosisSet = new Set(
    (diagnosisCodes || []).map((code) => normalizeIcd10Cm(code)).filter(Boolean)
  );

  const diagnosisPointerError = (line) => {
    const pointers = String(line?.diagnosisPointers || "")
      .split(",")
      .map((value) => normalizeIcd10Cm(value))
      .filter(Boolean);

    if (!line?.cptHcpcsCode?.trim()) return "";
    if (!pointers.length) return "Link this service line to at least one claim diagnosis.";
    const invalid = pointers.find((pointer) => !normalizedDiagnosisSet.has(pointer));
    return invalid
      ? `${invalid} is not one of the claim ICD-10 codes.`
      : "";
  };

  return (
    <Stack
      spacing={2}
      data-fix-field="serviceLines"
      sx={
        highlightField
          ? {
              p: 1.5,
              border: "2px solid",
              borderColor: "warning.main",
              borderRadius: 1
            }
          : undefined
      }
    >
      {lines.map((line, index) => (
        <Box key={index} sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1}
            sx={{ mb: 1 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography fontWeight={600}>Service Line {index + 1}</Typography>
              {line.source === "DOCUMENT_OCR" && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={line.verified ? "success" : "warning"}
                  label={line.verified ? "OCR verified" : "OCR suggestion — verify"}
                />
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              {line.source === "DOCUMENT_OCR" && !line.verified && (
                <Button
                  size="small"
                  color="success"
                  variant="outlined"
                  onClick={() => updateLine(index, "verified", true)}
                >
                  Verify Line
                </Button>
              )}
              <Button size="small" color="error" onClick={() => removeLine(index)}>
                Remove
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
            <TextField
              data-fix-field={index === 0 ? "cptHcpcsCode" : undefined}
              label="CPT / HCPCS"
              color={isHighlighted("cptHcpcsCode") ? "warning" : "primary"}
              focused={index === 0 && isHighlighted("cptHcpcsCode")}
              value={line.cptHcpcsCode}
              onChange={(event) => updateLine(index, "cptHcpcsCode", normalizeProcedureCode(event.target.value))}
              error={!!cptHcpcsError(line.cptHcpcsCode)}
              helperText={cptHcpcsError(line.cptHcpcsCode) || "CPT: 5 digits; HCPCS: letter + 4 digits"}
              inputProps={{ maxLength: 5 }}
            />
            <TextField
              label="Modifiers (comma separated)"
              value={line.modifiers}
              onChange={(event) => updateLine(index, "modifiers", event.target.value.toUpperCase())}
              error={!!modifiersError(line.modifiers)}
              helperText={modifiersError(line.modifiers) || "Up to 4 modifiers; each exactly 2 characters"}
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
              data-fix-field={index === 0 ? "diagnosisPointers" : undefined}
              label="Linked Diagnosis Codes"
              color={isHighlighted("diagnosisPointers") ? "warning" : "primary"}
              focused={index === 0 && isHighlighted("diagnosisPointers")}
              value={line.diagnosisPointers}
              onChange={(event) => updateLine(index, "diagnosisPointers", event.target.value.toUpperCase())}
              error={Boolean(diagnosisPointerError(line))}
              helperText={
                diagnosisPointerError(line) ||
                (diagnosisCodes.length
                  ? `Use claim diagnoses only: ${diagnosisCodes.join(", ")}`
                  : "Add ICD-10-CM diagnoses to the claim first; then link them here.")
              }
            />
            {claimForm === "PROFESSIONAL" && (
              <TextField
                data-fix-field={index === 0 ? "placeOfService" : undefined}
                label="Place of Service"
                select
                color={isHighlighted("placeOfService") ? "warning" : "primary"}
                focused={index === 0 && isHighlighted("placeOfService")}
                value={line.placeOfService}
                onChange={(event) => updateLine(index, "placeOfService", event.target.value)}
                helperText="CMS two-digit Place of Service code"
              >
                <MenuItem value="">Select Place of Service</MenuItem>
                {POS_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.value} — {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
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
            {claimForm === "INSTITUTIONAL" && (
              <>
                <TextField
                  data-fix-field={index === 0 ? "revenueCode" : undefined}
                  label="Revenue Code"
                  color={isHighlighted("revenueCode") ? "warning" : "primary"}
                  focused={index === 0 && isHighlighted("revenueCode")}
                  value={line.revenueCode}
                  onChange={(event) => updateLine(index, "revenueCode", event.target.value.replace(/\D/g, "").slice(0, 4))}
                  error={!!revenueCodeError(line.revenueCode)}
                  helperText={revenueCodeError(line.revenueCode) || "Exactly 4 digits; verify the payer/NUBC code"}
                  inputProps={{ inputMode: "numeric", maxLength: 4 }}
                />
                <TextField
                  label="POA Indicator"
                  select
                  value={line.poaIndicator}
                  onChange={(event) => updateLine(index, "poaIndicator", event.target.value)}
                  helperText="Present on Admission indicator when required"
                >
                  {POA_OPTIONS.map((option) => (
                    <MenuItem key={option.value || "none"} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
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
