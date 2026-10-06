import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentCodingSuggestions,
  validateCodingCode
} from "../src/services/codingSuggestions.js";

test("Coding - explicit ICD/CPT/HCPCS values become pending review candidates", () => {
  const result = buildDocumentCodingSuggestions({
    extracted: {
      icd10Codes: ["E11.9", "E11.9"],
      cptCodes: ["99213", "J3490"]
    },
    rawText: "Assessment ICD-10: E11.9. Procedures CPT: 99213, J3490.",
    confidence: 91
  });

  assert.deepEqual(
    result.map((item) => [item.system, item.suggestedCode]),
    [
      ["ICD10_CM", "E11.9"],
      ["CPT", "99213"],
      ["HCPCS", "J3490"]
    ]
  );
  assert.equal(result.every((item) => item.confidence === 91), true);
  assert.match(result[0].evidenceText, /E11\.9/);
});

test("Coding - code validation supports reviewed US coding systems", () => {
  assert.equal(validateCodingCode("ICD10_CM", "e11.9").error, null);
  assert.equal(validateCodingCode("CPT", "99213").error, null);
  assert.equal(validateCodingCode("HCPCS", "j3490").error, null);
  assert.equal(validateCodingCode("ICD10_PCS", "0FT44ZZ").error, null);

  assert.match(validateCodingCode("ICD10_CM", "not-a-code").error, /ICD-10-CM/);
  assert.match(validateCodingCode("CPT", "1234").error, /CPT/);
});

test("Coding - document route no longer silently writes OCR codes into the claim", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.resolve(here, "../src/routes/documents.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /claimData\.icd10Codes\s*=\s*extracted\.icd10Codes/);
  assert.doesNotMatch(source, /updatePayload\.icd10Codes\s*=\s*extracted\.icd10Codes/);
  assert.doesNotMatch(source, /await persistExtractedServiceLines\(tx,/);
  assert.match(source, /syncDocumentCodingSuggestions/);
  assert.match(source, /CODING_SUGGESTION_/);
  assert.match(source, /applyCodingSuggestionToClaim/);
});
