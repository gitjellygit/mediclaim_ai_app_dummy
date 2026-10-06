import { expect } from "@playwright/test";

export function observeBrowser(page, testInfo, {
  allowConsoleError = () => false,
  allowResponse = () => false
} = {}) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const serverErrors = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const entry = {
      text: message.text(),
      location: message.location()
    };
    if (!allowConsoleError(entry)) consoleErrors.push(entry);
  });

  page.on("pageerror", (error) => {
    pageErrors.push({
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || null
    });
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown";
    if (failure.includes("ERR_ABORTED")) return;
    failedRequests.push({
      method: request.method(),
      url: request.url(),
      failure
    });
  });

  page.on("response", (response) => {
    if (response.status() < 500) return;
    const entry = {
      status: response.status(),
      method: response.request().method(),
      url: response.url()
    };
    if (!allowResponse(entry)) serverErrors.push(entry);
  });

  return {
    async assertClean() {
      const report = {
        consoleErrors,
        pageErrors,
        failedRequests,
        serverErrors
      };

      await testInfo.attach("browser-observability.json", {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: "application/json"
      });

      expect(pageErrors, "uncaught page errors").toEqual([]);
      expect(consoleErrors, "unexpected browser console errors").toEqual([]);
      expect(serverErrors, "unexpected HTTP 5xx responses").toEqual([]);
      expect(failedRequests, "unexpected failed browser requests").toEqual([]);
    }
  };
}
