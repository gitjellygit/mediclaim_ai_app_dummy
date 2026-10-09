import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { hasPermission } from "../security/permissions.js";
import { writeRequestAudit } from "../services/auditLog.js";

function legacySessionAllowed() {
  return process.env.NODE_ENV !== "production";
}

async function activeSession(payload) {
  if (!payload.sid) return legacySessionAllowed();

  const session = await prisma.refreshToken.findFirst({
    where: {
      userId: payload.sub,
      sessionId: payload.sid,
      revoked: false,
      expiresAt: { gt: new Date() }
    },
    select: { id: true }
  });

  return Boolean(session);
}

function tokenUser(payload) {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    organizationId: payload.organizationId,
    sessionId: payload.sid || null,
    iat: payload.iat,
    exp: payload.exp
  };
}

function validatePayload(payload) {
  return Boolean(
    payload &&
      payload.type === "access" &&
      payload.sub &&
      payload.email &&
      payload.role &&
      payload.organizationId
  );
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication token required"
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!validatePayload(payload)) {
      return res.status(401).json({
        error: "Invalid token",
        message: "Token missing required claims"
      });
    }

    if (!(await activeSession(payload))) {
      return res.status(401).json({
        error: "Session revoked",
        message: "This session is no longer active. Please login again.",
        code: "SESSION_REVOKED"
      });
    }

    req.user = tokenUser(payload);
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired",
        message: "Your session has expired. Please login again.",
        code: "TOKEN_EXPIRED"
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid token",
        message: "Authentication token is invalid"
      });
    }

    console.error("[auth] access validation failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    return res.status(401).json({
      error: "Authentication failed",
      message: "Unable to verify authentication token"
    });
  }
}

export function requireRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error("requireRoles: roles must be a non-empty array");
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required"
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Access denied. Required roles: ${roles.join(", ")}`
      });
    }

    next();
  };
}

export async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (validatePayload(payload) && (await activeSession(payload))) {
        req.user = tokenUser(payload);
      }
    } catch {
      // Optional authentication intentionally ignores invalid credentials.
    }
  }

  next();
}


export function requirePermission(permission) {
  if (!permission) {
    throw new Error("requirePermission: permission is required");
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required"
      });
    }

    if (!hasPermission(req.user, permission)) {
      void writeRequestAudit(prisma, req, {
        action: "PHI_ACCESS_DENIED",
        entityType: "Permission",
        entityId: permission,
        outcome: "DENIED",
        statusCode: 403,
        metadata: {
          operation: "permission_denied",
          reason: permission
        }
      });

      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have permission to access this resource.",
        code: "PHI_PERMISSION_DENIED",
        permission
      });
    }

    next();
  };
}
