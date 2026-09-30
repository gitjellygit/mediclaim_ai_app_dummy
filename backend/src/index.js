import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma, disconnectDatabase } from "./db.js";
import { captureAsyncRouter } from "./middleware/asyncRouter.js";
import { requireAuth, requireRoles } from "./middleware/auth.js";

import claimsRouter from "./routes/claims.js";
import rulesRouter from "./routes/rules.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import denialsRouter from "./routes/denials.js";
import { e2eFixturesRouter } from "./routes/e2eFixtures.js";
dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

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

    res.json({ user });
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

/**
 * DOCUMENT ROUTES
 * documentsRouter IS A FUNCTION → must be CALLED
 */
app.use("/api/documents", requireAuth, captureAsyncRouter(documentsRouter(prisma, process.env.UPLOAD_DIR || "uploads")));

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Centralized error handler: unexpected failures never leak database internals.
app.use((err, req, res, _next) => {
  console.error("[request-error]", { route: req.path, code: err.code || null, name: err.name });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large", message: "Upload exceeds the allowed file size", code: "FILE_TOO_LARGE" });
  if (err.code === "INVALID_UPLOAD_TYPE") return res.status(415).json({ error: "Unsupported file", message: "Upload PDF, PNG, JPEG or TIFF only", code: "UNSUPPORTED_FILE" });
  return res.status(500).json({ error: "Internal server error", message: "The request could not be completed", code: "INTERNAL_ERROR" });
});

process.once("SIGTERM", async () => { await disconnectDatabase(); process.exit(0); });
process.once("SIGINT", async () => { await disconnectDatabase(); process.exit(0); });
