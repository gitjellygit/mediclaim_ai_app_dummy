import express from "express";
import cors from "cors";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { claimsRouter } from "./routes/claims.js";
import { rulesRouter } from "./routes/rules.js";
import { documentsRouter } from "./routes/documents.js";
import { checksRouter } from "./routes/checks.js";
import { authRouter } from "./routes/auth.js";

import { requireAuth, requireRole } from "./middleware/auth.js";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

const uploadDir = path.join(process.cwd(), "uploads");

// Public
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter(prisma));
app.use("/api/documents", documentsRouter(prisma, uploadDir)); // Temporarily public for testing

// Protected
app.use("/api/claims", requireAuth, claimsRouter(prisma));
app.use("/api/checks", requireAuth, checksRouter(prisma));

// Rules: admin only
app.use("/api/rules", requireAuth, requireRole("admin"), rulesRouter(prisma));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
