import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

test("integration foundation correlates synthetic claim events idempotently", async () => {
  const api = await request.newContext({ baseURL: backendURL });
  const login = await api.post("/api/auth/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const suffix = String(Date.now());

  const claimResponse = await api.post("/api/claims", {
    headers,
    data: {
      patientName: "Integration Synthetic",
      payerName: "Synthetic Payer",
      amount: 125
    }
  });
  expect(claimResponse.ok()).toBeTruthy();
  const claim = await claimResponse.json();

  const connectionResponse = await api.post("/api/integrations", {
    headers,
    data: {
      name: `EHR Sandbox ${suffix}`,
      kind: "EHR",
      provider: "SYNTHETIC_EHR",
      environment: "SANDBOX"
    }
  });
  expect(connectionResponse.status()).toBe(201);
  const connection = await connectionResponse.json();

  const externalClaimId = `EXT-CLAIM-${suffix}`;
  const link = await api.post(`/api/integrations/${connection.id}/claim-links`, {
    headers,
    data: { claimId: claim.id, externalClaimId }
  });
  expect(link.status()).toBe(201);

  const externalEventId = `EXT-EVENT-${suffix}`;
  const first = await api.post(`/api/integrations/${connection.id}/events`, {
    headers,
    data: {
      externalEventId,
      eventType: "CLAIM_UPDATED",
      direction: "INBOUND",
      status: "PROCESSED",
      externalClaimId,
      sourceStatus: "READY",
      correlationId: `CORR-${suffix}`
    }
  });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  expect(firstBody.duplicate).toBe(false);
  expect(firstBody.event.claimId).toBe(claim.id);
  expect(firstBody.event.payloadHash).toMatch(/^[a-f0-9]{64}$/);

  const replay = await api.post(`/api/integrations/${connection.id}/events`, {
    headers,
    data: {
      externalEventId,
      eventType: "CLAIM_UPDATED",
      direction: "INBOUND",
      status: "PROCESSED",
      externalClaimId,
      sourceStatus: "READY"
    }
  });
  expect(replay.ok()).toBeTruthy();
  const replayBody = await replay.json();
  expect(replayBody.duplicate).toBe(true);
  expect(replayBody.event.id).toBe(firstBody.event.id);

  const rawPayload = await api.post(`/api/integrations/${connection.id}/events`, {
    headers,
    data: {
      externalEventId: `RAW-${suffix}`,
      eventType: "CLAIM_UPDATED",
      direction: "INBOUND",
      status: "RECEIVED",
      rawPayload: { patientName: "Must not be accepted" }
    }
  });
  expect(rawPayload.status()).toBe(400);

  const health = await api.patch(`/api/integrations/${connection.id}/health`, {
    headers,
    data: { status: "DEGRADED", errorCode: "SYNTHETIC_TIMEOUT" }
  });
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).status).toBe("DEGRADED");

  const events = await api.get(`/api/integrations/${connection.id}/events`, { headers });
  expect(events.ok()).toBeTruthy();
  expect((await events.json()).items).toHaveLength(1);

  await api.dispose();
});
