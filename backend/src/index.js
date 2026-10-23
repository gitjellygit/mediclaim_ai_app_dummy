import express from "express";
import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { prisma, disconnectDatabase } from "./db.js";
import { captureAsyncRouter } from "./middleware/asyncRouter.js";
import { standardizeApiErrors } from "./middleware/apiErrors.js";
import { requireAuth, requireRoles } from "./middleware/auth.js";
import { permissionList } from "./security/permissions.js";

import claimsRouter from "./routes/claims.js";
import rulesRouter from "./routes/rules.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import denialsRouter from "./routes/denials.js";
import underpaymentsRouter from "./routes/underpayments.js";
import revenueRecoveryRouter from "./routes/revenueRecovery.js";
import auditRouter from "./routes/audit.js";
import analyticsRouter from "./routes/analytics.js";
import payerConnectorsRouter from "./routes/payerConnectors.js";
import integrationsRouter from "./routes/integrations.js";
import priorAuthCasesRouter from "./routes/priorAuthCases.js";
import { e2eFixturesRouter } from "./routes/e2eFixtures.js";
import { assertDocumentStorageConfiguration } from "./services/documentStorage.js";
import { createMemoryRateLimiter } from "./middleware/rateLimit.js";
dotenv.config();

const INSECURE_JWT_SECRETS = new Set([
  "replace-this-with-a-unique-secret-of-at-least-32-characters",
  "your-secret-key-here-min-32-chars",
  "claim-app-ci-only-signing-secret-32-characters"
]);

if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.length < 32 ||
  (process.env.NODE_ENV !== "test" && INSECURE_JWT_SECRETS.has(process.env.JWT_SECRET))
) {
  throw new Error(
    "JWT_SECRET must be a unique secret of at least 32 characters and must not use a documented placeholder"
  );
}

assertDocumentStorageConfiguration();

const app = express();
app.disable("x-powered-by");

// Security headers are centralized here so every route, including errors,
// receives the same baseline. HSTS is emitted only in production where TLS
// termination is expected at the trusted reverse proxy/load balancer.
app.use(
  helmet({
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false
  })
);

// Only trust the immediate reverse proxy when explicitly enabled. This keeps
// req.ip useful without blindly trusting spoofable X-Forwarded-For headers.
if (String(process.env.TRUST_PROXY || "").toLowerCase() === "true") {
  app.set("trust proxy", 1);
}

app.use((req, res, next) => {
  const incoming = String(req.get("x-request-id") || "").trim();
  req.auditRequestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.auditRequestId);
  next();
});

const configuredCorsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && configuredCorsOrigins.length === 0) {
  throw new Error("CORS_ORIGIN must be configured in production");
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (configuredCorsOrigins.length === 0) {
        return callback(null, process.env.NODE_ENV !== "production");
      }
      return callback(null, configuredCorsOrigins.includes(origin));
    }
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(standardizeApiErrors);

const apiRateLimiter = createMemoryRateLimiter({
  windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.API_RATE_LIMIT_MAX || 300),
  code: "API_RATE_LIMITED"
});
const analyticsRateLimiter = rateLimit({
  windowMs: Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.ANALYTICS_RATE_LIMIT_MAX || 60),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "Analytics request rate limit exceeded. Retry after the current window resets.",
    code: "ANALYTICS_RATE_LIMITED"
  }
});
const integrationsRateLimiter = rateLimit({
  windowMs: Number(process.env.INTEGRATIONS_RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.INTEGRATIONS_RATE_LIMIT_MAX || 120),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "Integration API rate limit exceeded. Retry after the current window resets.",
    code: "INTEGRATIONS_RATE_LIMITED"
  }
});
const expensiveOperationRateLimiter = createMemoryRateLimiter({
  windowMs: Number(process.env.EXPENSIVE_RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.EXPENSIVE_RATE_LIMIT_MAX || 30),
  code: "EXPENSIVE_OPERATION_RATE_LIMITED",
  shouldLimit(req) {
    return /\/documents\/upload(?:\?|$)|\/check(?:\?|$)|\/submit(?:\?|$)|\/journey\/|\/payer-simulation\//.test(
      req.originalUrl || ""
    );
  }
});
// Automated integration/E2E suites exercise many requests through one loopback
// address; keep the production middleware testable in isolation without making
// unrelated test order affect API assertions.
if (
  process.env.NODE_ENV !== "test" ||
  process.env.ENABLE_RATE_LIMITS_IN_TEST === "true"
) {
  app.use("/api", apiRateLimiter);
  app.use("/api", expensiveOperationRateLimiter);
}

let shuttingDown = false;
app.get("/health", (_, res) => res.json({ ok: true }));
app.get("/health/live", (_, res) => res.json({ ok: true }));
app.get("/health/ready", async (_req, res) => {
  if (shuttingDown) {
    return res.status(503).json({ ok: false, reason: "shutting_down" });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true });
  } catch (error) {
    console.error("[readiness] database check failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    return res.status(503).json({ ok: false, reason: "database_unavailable" });
  }
});

/**
 * AUTH ROUTES
 * authRouter IS A FUNCTION → must be CALLED
 */
app.use("/api/auth", captureAsyncRouter(authRouter(prisma)));

// Protected auth endpoints
app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    res.json({
      user: {
        ...user,
        permissions: permissionList(user)
      }
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while fetching user data"
    });
  }
});

/**
 * CLAIM ROUTES
 * claimsRouter IS ALREADY A ROUTER → DO NOT CALL IT
 */
app.use("/api/claims", requireAuth, captureAsyncRouter(claimsRouter));
if (process.env.E2E_TEST_MODE === "true") {
  app.use("/api/claims", requireAuth, requireRoles(["ADMIN"]), captureAsyncRouter(e2eFixturesRouter(prisma)));
}
app.use("/api/denials", requireAuth, captureAsyncRouter(denialsRouter));
app.use("/api/underpayments", requireAuth, captureAsyncRouter(underpaymentsRouter));
app.use("/api/revenue-recovery", requireAuth, captureAsyncRouter(revenueRecoveryRouter));
app.use(
  "/api/analytics",
  analyticsRateLimiter,
  requireAuth,
  captureAsyncRouter(analyticsRouter)
);
app.use("/api/payer-connectors", requireAuth, captureAsyncRouter(payerConnectorsRouter));
app.use("/api/integrations", integrationsRateLimiter, requireAuth, captureAsyncRouter(integrationsRouter));
app.use("/api/prior-auth", requireAuth, captureAsyncRouter(priorAuthCasesRouter));

/**
 * DOCUMENT ROUTES
 * documentsRouter IS A FUNCTION → must be CALLED
 */
const documentsApiRouter = captureAsyncRouter(
  documentsRouter(prisma, process.env.UPLOAD_DIR || "uploads")
);
app.use("/api/claims/documents", requireAuth, documentsApiRouter); // Legacy URL alias
app.use("/api/documents", requireAuth, documentsApiRouter);

/**
 * RULE ROUTES (ADMIN ONLY)
 * rulesRouter IS ALREADY A ROUTER → DO NOT CALL IT
 */
app.use(
  "/api/rules",
  requireAuth,
  requireRoles(["ADMIN"]),
  captureAsyncRouter(rulesRouter)
);

app.use(
  "/api/audit",
  requireAuth,
  requireRoles(["ADMIN"]),
  captureAsyncRouter(auditRouter)
);

const PORT = process.env.PORT || 4000;

// Centralized error handler: unexpected failures never leak database internals.
app.use((err, req, res, _next) => {
  console.error("[request-error]", { route: req.path, code: err.code || null, name: err.name });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large", message: "Upload exceeds the allowed file size", code: "FILE_TOO_LARGE" });
  if (err.code === "INVALID_UPLOAD_TYPE") return res.status(415).json({ error: "Unsupported file", message: "Upload PDF, PNG, JPEG or TIFF only", code: "UNSUPPORTED_FILE" });
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      message: err.message,
      code: err.code || "DOMAIN_ERROR"
    });
  }
  return res.status(500).json({ error: "Internal server error", message: "The request could not be completed", code: "INTERNAL_ERROR" });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; stopping HTTP server`);

  const forceCloseTimer = setTimeout(() => {
    console.error("[shutdown] graceful timeout exceeded; closing remaining connections");
    server.closeAllConnections?.();
  }, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 10000));
  forceCloseTimer.unref?.();

  server.close(async (closeError) => {
    try {
      if (closeError) {
        console.error("[shutdown] HTTP server close failed", { message: closeError.message });
      }
      await disconnectDatabase();
      clearTimeout(forceCloseTimer);
      process.exit(closeError ? 1 : 0);
    } catch (error) {
      console.error("[shutdown] database disconnect failed", { message: error?.message });
      process.exit(1);
    }
  });
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
