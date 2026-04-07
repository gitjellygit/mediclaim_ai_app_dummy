import { api, setToken, getToken, setRefreshToken, getRefreshToken, clearTokens } from "./client.js";

export const AuthApi = {
  /**
   * Login with email and password
   * Returns access token and refresh token
   */
  async login(email, password) {
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!res?.accessToken) {
      throw new Error(res?.message || "Login failed: no token returned");
    }

    // Store tokens
    setToken(res.accessToken);
    if (res.refreshToken) {
      setRefreshToken(res.refreshToken);
    }

    // Store user info
    if (res.user) {
      localStorage.setItem("user", JSON.stringify(res.user));
    }

    return res;
  },

  /**
   * Refresh access token using refresh token
   */
  async refreshToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    try {
      const res = await api("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });

      if (!res?.accessToken) {
        throw new Error("Token refresh failed");
      }

      setToken(res.accessToken);
      return res.accessToken;
    } catch (error) {
      // Refresh token is invalid or expired - clear everything
      clearTokens();
      throw error;
    }
  },

  /**
   * Logout - revoke refresh token
   */
  async logout() {
    const refreshToken = getRefreshToken();
    
    try {
      if (refreshToken) {
        await api("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
      // Continue with local cleanup even if API call fails
    } finally {
      clearTokens();
    }
  },

  /**
   * Logout from all devices
   */
  async logoutAll() {
    try {
      await api("/api/auth/logout-all", {
        method: "POST"
      });
    } catch (error) {
      console.error("Logout all error:", error);
    } finally {
      clearTokens();
    }
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser() {
    const res = await api("/api/auth/me");
    return res?.user || null;
  },

  /**
   * Get stored user from localStorage
   */
  getUser() {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  },

  /**
   * Reset account lockout (for development/testing)
   */
  async resetLockout(email) {
    try {
      // Use fetch directly to avoid token refresh issues for this endpoint
      const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
      const res = await fetch(`${API_BASE_URL}/api/auth/reset-lockout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMessage = text || `Request failed: ${res.status}`;
        try {
          const errorJson = JSON.parse(text);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        } catch {
          // Not JSON, use text as-is
        }
        throw new Error(errorMessage);
      }

      return res.json();
    } catch (error) {
      console.error("Reset lockout API error:", error);
      throw error;
    }
  }
};
