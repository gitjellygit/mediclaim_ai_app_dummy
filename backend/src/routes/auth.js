import crypto from "node:crypto";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import express from "express";
import jwt from "jsonwebtoken";
import {
  comparePassword,
  generateSecureToken
} from "../utils/security.js";
import {
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthRateLimit
} from "../services/authRateLimit.js";
import { durationToMs } from "../utils/duration.js";
import { writeAuditEvent } from "../services/auditLog.js";
import { permissionList } from "../security/permissions.js";

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const ACCOUNT_LOCKOUT_DURATION = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_IP_FAILED_ATTEMPTS = 25;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_NAME = "claim_refresh_token";

function refreshLifetimeMs() {
  return durationToMs(
    REFRESH_TOKEN_EXPIRES_IN,
    7 * 24 * 60 * 60 * 1000
  );
}

function accessLifetimeSeconds() {
  return Math.max(
    1,
    Math.floor(
      durationToMs(ACCESS_TOKEN_EXPIRES_IN, 15 * 60 * 1000) / 1000
    )
  );
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function loginRateKeys(email, req) {
  const emailHash = crypto
    .createHash("sha256")
    .update(String(email || "").toLowerCase().trim())
    .digest("hex");
  const ipHash = crypto
    .createHash("sha256")
    .update(String(requestIp(req) || "unknown"))
    .digest("hex");

  return {
    emailKey: `login-email:${emailHash}`,
    ipKey: `login-ip:${ipHash}`
  };
}

function authAuditContext(req, statusCode = null) {
  return {
    ipAddress: requestIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
    httpMethod: req.method || null,
    httpPath: req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : (req.baseUrl || req.path || null),
    requestId: req.auditRequestId || null,
    statusCode
  };
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function refreshTokenFromRequest(req) {
  const cookieToken = readCookie(req, REFRESH_COOKIE_NAME);
  if (cookieToken) return cookieToken;

  // Compatibility for tests and local development while browsers move to
  // HttpOnly cookies. Production never accepts a refresh token from JSON.
  if (process.env.NODE_ENV !== "production") {
    return req.body?.refreshToken || null;
  }

  return null;
}

function cookieOptions(maxAge) {
  const configuredSameSite = String(
    process.env.REFRESH_COOKIE_SAME_SITE || "lax"
  ).toLowerCase();
  const sameSite = ["lax", "strict", "none"].includes(configuredSameSite)
    ? configuredSameSite
    : "lax";
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.REFRESH_COOKIE_SECURE === "true";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
    maxAge: Math.max(0, maxAge)
  };
}

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(
    REFRESH_COOKIE_NAME,
    token,
    cookieOptions(new Date(expiresAt).getTime() - Date.now())
  );
}

function clearRefreshCookie(res) {
  const options = cookieOptions(0);
  delete options.maxAge;
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

function signAccessToken(user, sessionId) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sid: sessionId,
      type: "access"
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function tokenCompatibilityResponse(rawRefreshToken) {
  if (process.env.NODE_ENV === "production") return {};
  return { refreshToken: rawRefreshToken };
}

async function revokeSession(prisma, userId, sessionId) {
  if (!userId || !sessionId) return;
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      sessionId,
      revoked: false
    },
    data: {
      revoked: true,
      revokedAt: new Date()
    }
  });
}

export function authRouter(prisma) {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({
          error: "Validation error",
          message: "Email and password are required"
        });
      }

      const emailKey = String(email).toLowerCase().trim();
      const rateKeys = loginRateKeys(emailKey, req);
      const [emailRateLimit, ipRateLimit] = await Promise.all([
        checkAuthRateLimit(
          prisma,
          rateKeys.emailKey,
          MAX_FAILED_ATTEMPTS,
          LOGIN_RATE_WINDOW_MS
        ),
        checkAuthRateLimit(
          prisma,
          rateKeys.ipKey,
          MAX_IP_FAILED_ATTEMPTS,
          LOGIN_RATE_WINDOW_MS
        )
      ]);
      const blockedRateLimit = !emailRateLimit.allowed
        ? emailRateLimit
        : !ipRateLimit.allowed
        ? ipRateLimit
        : null;
      if (blockedRateLimit) {
        return res.status(429).json({
          error: "Too many attempts",
          message: "Too many login attempts. Please try again later.",
          retryAfter: Math.max(
            1,
            Math.ceil((blockedRateLimit.resetAt.getTime() - Date.now()) / 1000)
          )
        });
      }

      const user = await prisma.user.findUnique({
        where: { email: emailKey }
      });

      if (!user) {
        await Promise.all([
          recordAuthFailure(prisma, rateKeys.emailKey, LOGIN_RATE_WINDOW_MS),
          recordAuthFailure(prisma, rateKeys.ipKey, LOGIN_RATE_WINDOW_MS)
        ]);
        return res.status(401).json({
          error: "Invalid credentials",
          message: "Invalid email or password"
        });
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const minutesLeft = Math.ceil(
          (new Date(user.lockedUntil) - new Date()) / 60000
        );
        return res.status(423).json({
          error: "Account locked",
          message: `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`
        });
      }

      const passwordValid = await comparePassword(password, user.passwordHash);

      if (!passwordValid) {
        await Promise.all([
          recordAuthFailure(prisma, rateKeys.emailKey, LOGIN_RATE_WINDOW_MS),
          recordAuthFailure(prisma, rateKeys.ipKey, LOGIN_RATE_WINDOW_MS)
        ]);
        const failedAttempts = user.failedLoginAttempts + 1;
        const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: failedAttempts,
            lockedUntil: shouldLock
              ? new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION)
              : null
          }
        });

        await writeAuditEvent(prisma, {
          organizationId: user.organizationId,
          actorUserId: user.id,
          ...authAuditContext(req, 401),
          action: shouldLock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
          entityType: "User",
          entityId: user.id,
          outcome: "DENIED",
          metadata: { reason: shouldLock ? "too_many_failed_attempts" : "invalid_credentials" }
        });

        return res.status(401).json({
          error: "Invalid credentials",
          message: "Invalid email or password"
        });
      }

      await clearAuthRateLimit(prisma, rateKeys.emailKey);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date()
        }
      });

      const sessionId = generateSecureToken(24);
      const refreshToken = generateSecureToken(64);
      const expiresAt = new Date(Date.now() + refreshLifetimeMs());

      await prisma.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(refreshToken),
          sessionId,
          userId: user.id,
          expiresAt,
          userAgent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
          ipAddress: requestIp(req)
        }
      });

      const accessToken = signAccessToken(user, sessionId);
      setRefreshCookie(res, refreshToken, expiresAt);

      await writeAuditEvent(prisma, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        ...authAuditContext(req, 200),
        action: "LOGIN_SUCCEEDED",
        entityType: "Session",
        entityId: sessionId,
        outcome: "SUCCESS",
        metadata: { sessionId }
      });

      res.json({
        accessToken,
        ...tokenCompatibilityResponse(refreshToken),
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          permissions: permissionList(user)
        },
        expiresIn: accessLifetimeSeconds()
      });
    } catch (error) {
      console.error("Login error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred during authentication"
      });
    }
  });

  router.post("/refresh", async (req, res) => {
    try {
      const rawRefreshToken = refreshTokenFromRequest(req);

      if (!rawRefreshToken) {
        clearRefreshCookie(res);
        return res.status(401).json({
          error: "Authentication required",
          message: "Refresh session is required",
          code: "REFRESH_REQUIRED"
        });
      }

      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(rawRefreshToken) },
        include: { user: true }
      });

      if (!tokenRecord) {
        clearRefreshCookie(res);
        return res.status(401).json({
          error: "Invalid token",
          message: "Refresh session is invalid",
          code: "INVALID_REFRESH_TOKEN"
        });
      }

      if (tokenRecord.revoked) {
        await revokeSession(
          prisma,
          tokenRecord.userId,
          tokenRecord.sessionId
        );
        clearRefreshCookie(res);
        return res.status(401).json({
          error: "Token revoked",
          message: "Refresh token reuse detected; the entire session has been revoked",
          code: "REFRESH_REUSE_DETECTED"
        });
      }

      if (new Date(tokenRecord.expiresAt) <= new Date()) {
        await prisma.refreshToken.updateMany({
          where: { id: tokenRecord.id, revoked: false },
          data: { revoked: true, revokedAt: new Date() }
        });
        clearRefreshCookie(res);
        return res.status(401).json({
          error: "Token expired",
          message: "Refresh session has expired",
          code: "REFRESH_EXPIRED"
        });
      }

      const nextRawRefreshToken = generateSecureToken(64);
      const now = new Date();

      const rotated = await prisma.$transaction(async (tx) => {
        const claim = await tx.refreshToken.updateMany({
          where: {
            id: tokenRecord.id,
            revoked: false
          },
          data: {
            revoked: true,
            revokedAt: now,
            lastUsedAt: now
          }
        });

        if (claim.count !== 1) return null;

        return tx.refreshToken.create({
          data: {
            tokenHash: hashRefreshToken(nextRawRefreshToken),
            sessionId: tokenRecord.sessionId,
            userId: tokenRecord.userId,
            expiresAt: tokenRecord.expiresAt,
            lastUsedAt: now,
            userAgent:
              String(req.headers["user-agent"] || "").slice(0, 500) ||
              tokenRecord.userAgent,
            ipAddress: requestIp(req) || tokenRecord.ipAddress
          }
        });
      });

      if (!rotated) {
        await revokeSession(
          prisma,
          tokenRecord.userId,
          tokenRecord.sessionId
        );
        clearRefreshCookie(res);
        return res.status(401).json({
          error: "Token revoked",
          message: "Refresh token reuse detected; the entire session has been revoked",
          code: "REFRESH_REUSE_DETECTED"
        });
      }

      const accessToken = signAccessToken(
        tokenRecord.user,
        tokenRecord.sessionId
      );
      setRefreshCookie(res, nextRawRefreshToken, tokenRecord.expiresAt);

      res.json({
        accessToken,
        ...tokenCompatibilityResponse(nextRawRefreshToken),
        expiresIn: accessLifetimeSeconds()
      });
    } catch (error) {
      console.error("Refresh token error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred while refreshing token"
      });
    }
  });

  router.post("/logout", async (req, res) => {
    try {
      const rawRefreshToken = refreshTokenFromRequest(req);

      if (rawRefreshToken) {
        const tokenRecord = await prisma.refreshToken.findUnique({
          where: { tokenHash: hashRefreshToken(rawRefreshToken) }
        });

        if (tokenRecord) {
          await revokeSession(
            prisma,
            tokenRecord.userId,
            tokenRecord.sessionId
          );
          const user = await prisma.user.findUnique({
            where: { id: tokenRecord.userId },
            select: { organizationId: true }
          });
          if (user) {
            await writeAuditEvent(prisma, {
              organizationId: user.organizationId,
              actorUserId: tokenRecord.userId,
              ...authAuditContext(req, 200),
              action: "LOGOUT_SUCCEEDED",
              entityType: "Session",
              entityId: tokenRecord.sessionId,
              metadata: { sessionId: tokenRecord.sessionId }
            });
          }
        }
      }

      clearRefreshCookie(res);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred during logout"
      });
    }
  });

  router.post("/logout-all", requireAuth, async (req, res) => {
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

      await writeAuditEvent(prisma, {
        organizationId: req.user.organizationId,
        actorUserId: req.user.id,
        ...authAuditContext(req, 200),
        action: "ALL_SESSIONS_REVOKED",
        entityType: "User",
        entityId: req.user.id,
        metadata: { operation: "logout_all" }
      });
      clearRefreshCookie(res);
      res.json({ message: "All sessions logged out successfully" });
    } catch (error) {
      console.error("Logout all error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred during logout"
      });
    }
  });

  router.get("/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await prisma.refreshToken.findMany({
        where: {
          userId: req.user.id,
          revoked: false,
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: "desc" },
        select: {
          sessionId: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          userAgent: true,
          ipAddress: true
        }
      });

      await writeAuditEvent(prisma, {
        organizationId: req.user.organizationId,
        actorUserId: req.user.id,
        ...authAuditContext(req, 200),
        action: "SESSIONS_VIEWED",
        entityType: "User",
        entityId: req.user.id,
        metadata: { count: sessions.length }
      });

      res.json({
        items: sessions.map((session) => ({
          ...session,
          current: session.sessionId === req.user.sessionId
        }))
      });
    } catch (error) {
      console.error("List sessions error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "Unable to list active sessions"
      });
    }
  });

  router.delete("/sessions/:sessionId", requireAuth, async (req, res) => {
    try {
      const result = await prisma.refreshToken.updateMany({
        where: {
          userId: req.user.id,
          sessionId: req.params.sessionId,
          revoked: false
        },
        data: {
          revoked: true,
          revokedAt: new Date()
        }
      });

      if (result.count === 0) {
        return res.status(404).json({
          error: "Session not found",
          message: "Session not found",
          code: "NOT_FOUND"
        });
      }

      await writeAuditEvent(prisma, {
        organizationId: req.user.organizationId,
        actorUserId: req.user.id,
        ...authAuditContext(req, 200),
        action: "SESSION_REVOKED",
        entityType: "Session",
        entityId: req.params.sessionId,
        metadata: { sessionId: req.params.sessionId }
      });

      if (req.params.sessionId === req.user.sessionId) {
        clearRefreshCookie(res);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Revoke session error:", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Internal server error",
        message: "Unable to revoke session"
      });
    }
  });

  router.post(
    "/reset-lockout",
    requireAuth,
    requireRoles(["ADMIN"]),
    async (req, res) => {
      if (process.env.NODE_ENV === "production") {
        return res
          .status(404)
          .json({ error: "Not found", code: "NOT_FOUND" });
      }

      try {
        const { email } = req.body || {};

        if (!email) {
          return res.status(400).json({
            error: "Validation error",
            message: "Email is required"
          });
        }

        const emailKey = email.toLowerCase().trim();
        const { emailKey: emailRateKey } = loginRateKeys(emailKey, req);
        await clearAuthRateLimit(prisma, emailRateKey);

        const user = await prisma.user.findFirst({
          where: {
            email: emailKey,
            organizationId: req.user.organizationId
          }
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: 0,
              lockedUntil: null
            }
          });
        }

        res.json({
          message: "Account lockout and rate limits reset successfully",
          email: emailKey,
          success: true
        });
      } catch (error) {
        console.error("Reset lockout error:", {
          name: error?.name || "Error",
          code: error?.code || null
        });
        res.status(500).json({
          error: "Internal server error",
          message: "An error occurred while resetting lockout"
        });
      }
    }
  );

  return router;
}
