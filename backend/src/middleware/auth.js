import jwt from "jsonwebtoken";

/**
 * Industry-standard authentication middleware
 * Validates JWT token and attaches user to request
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ 
      error: "Unauthorized",
      message: "Authentication token required"
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    // Validate token structure
    if (!payload.sub || !payload.email || !payload.role) {
      return res.status(401).json({ 
        error: "Invalid token",
        message: "Token missing required claims"
      });
    }

    // Attach user to request
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp
    };
    
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

    return res.status(401).json({ 
      error: "Authentication failed",
      message: "Unable to verify authentication token"
    });
  }
}

/**
 * Role-based authorization middleware
 * Ensures user has one of the required roles
 */
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

/**
 * Optional auth - attaches user if token is present but doesn't require it
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.sub && payload.email && payload.role) {
        req.user = {
          id: payload.sub,
          email: payload.email,
          role: payload.role
        };
      }
    } catch {
      // Ignore errors for optional auth
    }
  }

  next();
}
