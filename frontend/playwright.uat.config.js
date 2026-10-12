import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/manual",
  testMatch: "approval-uat-fixtures.manual.spec.js",
  testIgnore: [],
  retries: 0,
  reporter: [["list"]]
});
