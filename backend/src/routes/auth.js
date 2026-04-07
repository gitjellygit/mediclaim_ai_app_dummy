import express from "express";
import jwt from "jsonwebtoken";
import { hashPassword, comparePassword, validatePassword, checkRateLimit, generateSecureToken, clearRateLimit } from "../utils/security.js";

// Token expiration times
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m"; // Short-lived access token
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"; // Long-lived refresh token
const ACCOUNT_LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes
const MAX_FAILED_ATTEMPTS = 5;

export function authRouter(prisma) {
  const router = express.Router();

  /**
   * POST /api/auth/login
   * Authenticate user and return access + refresh tokens
   */
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      // Input validation
      if (!email || !password) {
        return res.status(400).json({ 
          error: "Validation error",
          message: "Email and password are required"
        });
      }

      // Rate limiting
      const rateLimit = checkRateLimit(`login:${email}`, MAX_FAILED_ATTEMPTS);
      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: "Too many attempts",
          message: "Too many login attempts. Please try again later.",
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
        });
      }

      // Find user
      const user = await prisma.user.findUnique({ 
        where: { email: email.toLowerCase().trim() }
      });

      // Security: Don't reveal if user exists (prevents user enumeration)
      if (!user) {
        return res.status(401).json({ 
          error: "Invalid credentials",
          message: "Invalid email or password"
        });
      }

      // Check if account is locked
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const minutesLeft = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
        return res.status(423).json({
          error: "Account locked",
          message: `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`
        });
      }

      // Verify password
      const passwordValid = await comparePassword(password, user.passwordHash);
      
      if (!passwordValid) {
        // Increment failed attempts
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

        return res.status(401).json({ 
          error: "Invalid credentials",
          message: "Invalid email or password"
        });
      }

      // Reset failed attempts and update last login
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date()
        }
      });

      // Generate tokens
      const accessToken = jwt.sign(
        { 
          sub: user.id, 
          email: user.email, 
          role: user.role,
          type: "access"
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
      );

      const refreshToken = generateSecureToken(64);
      const refreshTokenExpiresAt = new Date();
      refreshTokenExpiresAt.setTime(refreshTokenExpiresAt.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days

      // Store refresh token
      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: refreshTokenExpiresAt
        }
      });

      // Return tokens and user info
      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role
        },
        expiresIn: 15 * 60 // 15 minutes in seconds
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred during authentication"
      });
    }
  });

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  router.post("/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          error: "Validation error",
          message: "Refresh token is required"
        });
      }

      // Find refresh token
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
      });

      if (!tokenRecord) {
        return res.status(401).json({
          error: "Invalid token",
          message: "Refresh token is invalid"
        });
      }

      // Check if token is revoked
      if (tokenRecord.revoked) {
        return res.status(401).json({
          error: "Token revoked",
          message: "Refresh token has been revoked"
        });
      }

      // Check if token is expired
      if (new Date(tokenRecord.expiresAt) < new Date()) {
        // Delete expired token
        await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
        return res.status(401).json({
          error: "Token expired",
          message: "Refresh token has expired"
        });
      }

      // Generate new access token
      const accessToken = jwt.sign(
        {
          sub: tokenRecord.user.id,
          email: tokenRecord.user.email,
          role: tokenRecord.user.role,
          type: "access"
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
      );

      res.json({
        accessToken,
        expiresIn: 15 * 60
      });
    } catch (error) {
      console.error("Refresh token error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred while refreshing token"
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Revoke refresh token
   */
  router.post("/logout", async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        await prisma.refreshToken.updateMany({
          where: { 
            token: refreshToken,
            revoked: false
          },
          data: {
            revoked: true,
            revokedAt: new Date()
          }
        });
      }

      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred during logout"
      });
    }
  });

  /**
   * POST /api/auth/logout-all
   * Revoke all refresh tokens for a user (requires auth middleware)
   * Note: This endpoint should be protected by requireAuth middleware in index.js
   */
  router.post("/logout-all", async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      await prisma.refreshToken.updateMany({
        where: {
          userId,
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

  /**
   * POST /api/auth/reset-lockout
   * Reset account lockout and rate limits (for development/testing)
   * In production, this should be protected and admin-only
   */
  router.post("/reset-lockout", async (req, res) => {
    try {
      const { email } = req.body;
      console.log("Reset lockout request for:", email);

      if (!email) {
        return res.status(400).json({
          error: "Validation error",
          message: "Email is required"
        });
      }

      const emailKey = email.toLowerCase().trim();
      const rateLimitKey = `login:${emailKey}`;

      // Clear rate limit for this email
      clearRateLimit(rateLimitKey);
      console.log("Cleared rate limit for:", rateLimitKey);

      // Unlock account in database
      const user = await prisma.user.findUnique({
        where: { email: emailKey }
      });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null
          }
        });
        console.log("Unlocked user account:", user.id);
      } else {
        console.log("User not found:", emailKey);
      }

      res.json({ 
        message: "Account lockout and rate limits reset successfully",
        email: emailKey,
        success: true
      });
    } catch (error) {
      console.error("Reset lockout error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message || "An error occurred while resetting lockout"
      });
    }
  });

  return router;
}
