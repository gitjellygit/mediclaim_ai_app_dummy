import { test, expect } from "@playwright/test";

test("B5 - protected 401 refreshes even when the rejected JWT has not expired", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const client = await import("/src/api/client.js");
    const jwt = (exp, label) => [
      "e30",
      btoa(JSON.stringify({ exp, label })).replace(/=+$/g, ""),
      "signature"
    ].join(".");
    const oldToken = jwt(Math.floor(Date.now() / 1000) + 3600, "rejected");
    const freshToken = jwt(Math.floor(Date.now() / 1000) + 3600, "refreshed");
    client.setToken(oldToken);
    client.setRefreshToken("test-refresh");

    const originalFetch = window.fetch;
    const calls = [];
    window.fetch = async (input, options = {}) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(options.headers).get("Authorization") });
      if (url.endsWith("/api/auth/refresh")) {
        return new Response(JSON.stringify({ accessToken: freshToken }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/api/claims/b5-protected-test")) {
        const token = new Headers(options.headers).get("Authorization");
        return new Response(
          JSON.stringify(token === `Bearer ${freshToken}` ? { ok: true } : { error: "Unauthorized" }),
          { status: token === `Bearer ${freshToken}` ? 200 : 401, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, options);
    };
    try {
      const data = await client.api("/api/claims/b5-protected-test");
      return { data, calls, storedToken: client.getToken(), freshToken };
    } finally {
      window.fetch = originalFetch;
      client.clearTokens();
    }
  });
  expect(result.data).toEqual({ ok: true });
  expect(result.calls.filter((call) => call.url.endsWith("/api/auth/refresh"))).toHaveLength(1);
  expect(result.calls.filter((call) => call.url.endsWith("/api/claims/b5-protected-test"))).toHaveLength(2);
  expect(result.storedToken).toBe(result.freshToken);
});

test("B5 - invalid login never clears existing session or redirects", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const client = await import("/src/api/client.js");
    client.setToken("existing-session");
    client.setRefreshToken("existing-refresh");
    const originalFetch = window.fetch;
    window.fetch = async (input, options) => {
      if (String(input).endsWith("/api/auth/login")) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }
      return originalFetch(input, options);
    };
    try {
      let status = null;
      try {
        await client.api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "bad@example.com", password: "wrong" }) });
      } catch (error) {
        status = error.status;
      }
      return { status, token: client.getToken(), refresh: client.getRefreshToken(), path: window.location.pathname };
    } finally {
      window.fetch = originalFetch;
      client.clearTokens();
    }
  });
  expect(result).toEqual({ status: 401, token: "existing-session", refresh: "existing-refresh", path: "/login" });
});
