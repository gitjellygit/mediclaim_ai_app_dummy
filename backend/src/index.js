import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

import claimsRouter from "./routes/claims.js";
import rulesRouter from "./routes/rules.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { requireAuth, requireRoles } from "./middleware/auth.js";

dotenv.config();

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * AUTH ROUTES
 * authRouter IS A FUNCTION → must be CALLED
 */
app.use("/api/auth", authRouter(prisma));

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

app.post("/api/auth/logout-all", requireAuth, async (req, res) => {
  try {
    await prisma.refreshToken.updateMany({
      where: {
        userId: req.user.id,
        revoked: false
      },
      data: {
        revoked: true,
        revokedAt: new Date()
      }
    });

    res.json({ message: "All sessions logged out successfully" });
  } catch (error) {
    console.error("Logout all error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "An error occurred during logout"
    });
  }
});

app.get("/api/debug", async (req, res) => {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    
    console.log("=== DATABASE DEBUG ===");
    
    const claims = await prisma.claim.findMany();
    console.log("All claims:", claims.length);
    
    const documents = await prisma.document.findMany();
    console.log("All documents:", documents.length);
    
    const documentsWithClaimId = await prisma.document.findMany({
      where: { claimId: { not: null } }
    });
    console.log("Documents with claimId:", documentsWithClaimId.length);
    
    // Check specific claim
    let firstClaimWithDocs = null;
    if (claims.length > 0) {
      firstClaimWithDocs = await prisma.claim.findUnique({
        where: { id: claims[0].id },
        include: { documents: true }
      });
      console.log("First claim with documents:", firstClaimWithDocs.documents.length);
    }
    
    res.json({
      claims: claims.length,
      documents: documents.length,
      documentsWithClaimId: documentsWithClaimId.length,
      sampleClaim: claims[0],
      sampleDocument: documents[0],
      firstClaimDocuments: firstClaimWithDocs?.documents || []
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * CLAIM ROUTES
 * claimsRouter IS ALREADY A ROUTER → DO NOT CALL IT
 */
app.use("/api/claims", requireAuth, claimsRouter);

/**
 * DOCUMENT ROUTES
 * documentsRouter IS A FUNCTION → must be CALLED
 */
app.use("/api/documents", requireAuth, documentsRouter(prisma, "uploads"));

/**
 * RULE ROUTES (ADMIN ONLY)
 * rulesRouter IS ALREADY A ROUTER → DO NOT CALL IT
 */
app.use(
  "/api/rules",
  requireAuth,
  requireRoles(["ADMIN"]),
  rulesRouter
);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
