import bcrypt from "bcryptjs";

/**
 * Password validation rules
 */
export function validatePassword(password) {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password) {
  const saltRounds = 12; // Industry standard: 10-12 rounds
  return bcrypt.hash(password, saltRounds);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  const crypto = globalThis.crypto || require("crypto");
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % chars.length;
    token += chars[randomIndex];
  }
  
  return token;
}
