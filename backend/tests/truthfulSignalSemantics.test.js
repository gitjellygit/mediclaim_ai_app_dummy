import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDocument } from "../src/services/docIntel.js";
import { analyzeDenial } from "../src/services/denialIntelligence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("document classification exposes heuristic score metadata instead of implying measured accuracy", () => {
  const result = classifyDocument({
    fileName: "final-bill.pdf",
    text: "Final Bill Total Amount"
  });

  assert.equal(result.suggestedType, "FINAL_BILL");
  assert.equal(result.confidenceKind, "HEURISTIC_RULE_SCORE");
  assert.ok(Number.isFinite(result.confidence));
});

test("rule-based denial analysis remains explicitly heuristic", async () => {
  const result = await analyzeDenial({
    amount: 500,
    paidAmount: 0,
    priorAuthRequired: true,
    priorAuthStatus: "REQUIRED",
    eligibilityStatus: "VERIFIED",
    icd10Codes: ["Z00.00"],
    documents: [{ type: "FINAL_BILL" }],
    claimType: "PROVIDER_BILLED"
  }, { denialCategory: "AUTHORIZATION" });

  assert.equal(result.provider, "RULE_ENGINE");
  assert.equal(result.llmUsed, false);
  assert.ok(Number.isFinite(result.confidence));
});

test("user interfaces label heuristic signals truthfully", () => {
  const docsUi = read("frontend/src/modules/documents/DocumentIntelligence.jsx");
  const denialsUi = read("frontend/src/modules/denials/DenialIntelligence.jsx");
  const workQueue = read("frontend/src/modules/approval/ApprovalIntelligence.jsx");

  assert.match(docsUi, /Classification signal/);
  assert.match(docsUi, /Heuristic signal/);
  assert.doesNotMatch(docsUi, /\{doc\.confidence \? `\$\{doc\.confidence\}%`/);

  assert.match(denialsUi, /Rule-based heuristic signal/);
  assert.match(denialsUi, /Model-reported signal/);

  assert.match(workQueue, /Validation Readiness/);
  assert.match(workQueue, /Rules-Based Risk/);
  assert.match(workQueue, /not payer approval likelihood/);
});
