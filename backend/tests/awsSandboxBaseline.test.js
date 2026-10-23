import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("AWS sandbox keeps data services private and encrypted", () => {
  const tf = read("infra/environments/sandbox/main.tf");
  assert.match(tf, /publicly_accessible = false/);
  assert.match(tf, /storage_encrypted = true/);
  assert.match(tf, /block_public_acls = true/);
  assert.match(tf, /restrict_public_buckets = true/);
  assert.match(tf, /sse_algorithm = "aws:kms"/);
  assert.match(tf, /enable_key_rotation = true/);
  assert.match(tf, /aws:SecureTransport/);
});

test("AWS sandbox uses managed secrets and keeps production PHI transmission off", () => {
  const tf = read("infra/environments/sandbox/main.tf");
  assert.match(tf, /aws_secretsmanager_secret/);
  assert.match(tf, /name = "DATABASE_URL"/);
  assert.match(tf, /name = "JWT_SECRET"/);
  assert.match(tf, /HIPAA_BAA_CONFIRMED", value = "false"/);
  assert.match(tf, /STEDI_PRODUCTION_PHI_CONFIRMED", value = "false"/);
  assert.match(tf, /STEDI_PRODUCTION_SUBMISSION_ENABLED", value = "false"/);
});

test("AWS sandbox includes operational and cost guardrails", () => {
  const tf = read("infra/environments/sandbox/main.tf");
  const workflow = read(".github/workflows/terraform-validate.yml");
  const readme = read("infra/environments/sandbox/README.md");
  assert.match(tf, /aws_budgets_budget/);
  assert.match(tf, /aws_cloudwatch_metric_alarm/);
  assert.match(tf, /image_scanning_configuration/);
  assert.match(workflow, /terraform validate/);
  assert.match(readme, /NON_PHI sandbox/);
  assert.match(readme, /Do not place real patient PHI/);
});
