import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("F9 - app routes use one protected layout, config arrays, and lazy page loading", () => {
  const app = read("frontend/src/App.jsx");
  const layout = read("frontend/src/layout/MainLayout.jsx");

  assert.ok(app.includes("lazy(() => import"));
  assert.ok(app.includes("<Suspense"));
  assert.ok(app.includes("const protectedRoutes = ["));
  assert.ok(app.includes("const adminRoutes = ["));
  assert.equal((app.match(/<MainLayout/g) || []).length, 1);
  assert.ok(layout.includes('import { Outlet } from "react-router-dom";'));
  assert.ok(layout.includes("{children ?? <Outlet />}"));
});

test("F9 - claim detail delegates data and feature sections to extracted modules", () => {
  const detail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");
  const dataHook = read(
    "frontend/src/modules/ai-claims/claim-detail/useClaimDetailData.js"
  );
  const automation = read(
    "frontend/src/modules/ai-claims/claim-detail/ClaimAutomationCard.jsx"
  );
  const completeness = read(
    "frontend/src/modules/ai-claims/claim-detail/ClaimCompletenessCard.jsx"
  );

  assert.ok(detail.includes("useClaimDetailData(id, location.key)"));
  assert.ok(detail.includes("<ClaimSummaryCard"));
  assert.ok(detail.includes("<ClaimAutomationCard"));
  assert.ok(detail.includes("<ClaimCompletenessCard"));
  assert.equal(detail.includes("setAutomationExpanded"), false);
  assert.equal(detail.includes("setCompletenessExpanded"), false);

  assert.ok(dataHook.includes("ClaimsApi.get(id)"));
  assert.ok(dataHook.includes('window.addEventListener("focus", refresh)'));
  assert.ok(automation.includes("Claim Automation"));
  assert.ok(completeness.includes("Claim Completeness"));
});
