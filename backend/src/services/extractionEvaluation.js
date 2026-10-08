import { classifyDocument, extractFields } from "./docIntel.js";
import {
  buildFieldCandidates,
  safeInitialClaimSeed
} from "./extractionEngineV2.js";

function comparable(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toUpperCase()).sort().join("|");
  }
  if (typeof value === "number") return value.toFixed(2);
  return String(value).trim().toUpperCase();
}

export function evaluateExtractionFixtures(fixtures = []) {
  const rows = [];
  let expectedCount = 0;
  let correct = 0;
  let wrong = 0;
  let missing = 0;
  let autoProposed = 0;
  let autoCorrect = 0;

  for (const fixture of fixtures) {
    const classification = classifyDocument({
      fileName: fixture.fileName,
      text: fixture.text
    });
    const extracted = extractFields(fixture.text);
    const candidates = buildFieldCandidates({
      claimId: fixture.claimId || "golden-claim",
      documentId: fixture.id || fixture.fileName,
      documentType: classification.suggestedType,
      extracted,
      intel: {
        ...classification,
        extractionConfidence: 99,
        ocrProvider: "PDF_PARSE"
      },
      rawText: fixture.text
    });
    const seed = safeInitialClaimSeed({
      documentType: classification.suggestedType,
      extracted,
      intel: {
        ...classification,
        extractionConfidence: 99,
        ocrProvider: "PDF_PARSE"
      },
      rawText: fixture.text
    });

    for (const [field, expected] of Object.entries(fixture.expected || {})) {
      expectedCount += 1;
      const actual = extracted[field];
      const isMissing =
        actual == null ||
        actual === "" ||
        (Array.isArray(actual) && actual.length === 0);
      const isCorrect = comparable(actual) === comparable(expected);

      if (isCorrect) correct += 1;
      else if (isMissing) missing += 1;
      else wrong += 1;

      if (Object.prototype.hasOwnProperty.call(seed, field)) {
        autoProposed += 1;
        if (comparable(seed[field]) === comparable(expected)) autoCorrect += 1;
      }

      rows.push({
        fixture: fixture.id || fixture.fileName,
        field,
        expected,
        actual,
        correct: isCorrect,
        autoProposed: Object.prototype.hasOwnProperty.call(seed, field),
        candidateDecision:
          candidates.find((candidate) => candidate.fieldName === field)?.decision ||
          null
      });
    }
  }

  const precision =
    correct + wrong > 0 ? correct / (correct + wrong) : 1;
  const recall = expectedCount > 0 ? correct / expectedCount : 1;
  const autoFillPrecision =
    autoProposed > 0 ? autoCorrect / autoProposed : 1;
  const abstentionRate =
    expectedCount > 0 ? 1 - autoProposed / expectedCount : 0;

  return {
    fixtures: fixtures.length,
    expectedFields: expectedCount,
    correct,
    wrong,
    missing,
    precision,
    recall,
    autoProposed,
    autoCorrect,
    autoFillPrecision,
    abstentionRate,
    rows
  };
}
