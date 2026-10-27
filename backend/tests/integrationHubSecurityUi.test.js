import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("integration claim updates preserve verified manual corrections", () => {
  const source = read("backend/src/services/integrationClaimMaterializer.js");
  assert.match(source, /protectedManualFields/);
  assert.match(source, /changedFields\(identity\.claim, safePatch\)/);
});

test("Integration Hub UI is permission routed and raw canonical data is not exposed", () => {
  const app = read("frontend/src/App.jsx");
  const nav = read("frontend/src/layout/LeftNav.jsx");
  const hub = read("frontend/src/modules/integrations/IntegrationHub.jsx");
  const route = read("backend/src/routes/integrations.js");
  assert.match(app, /\/integrations/);
  assert.match(app, /INTEGRATION_VIEW/);
  assert.match(nav, /INTEGRATION_VIEW/);
  assert.match(hub, /Integration Hub/);
  assert.doesNotMatch(route, /includeData/);
});
