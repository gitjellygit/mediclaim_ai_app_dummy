import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AuthApi } from "../api/auth.js";
import { getToken, getRefreshToken } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * Initialize auth state from localStorage and verify with backend
   */
  useEffect(() => {
    async function initializeAuth() {
      try {
        const storedUser = localStorage.getItem("user");
        const token = getToken();
        const refreshToken = getRefreshToken();

        // If we have tokens, verify with backend
        if (token || refreshToken) {
          try {
            const currentUser = await AuthApi.getCurrentUser();
            if (currentUser) {
              setUser(currentUser);
              // Update stored user if it exists
              if (storedUser) {
                const parsed = JSON.parse(storedUser);
                if (parsed.id !== currentUser.id) {
                  localStorage.setItem("user", JSON.stringify(currentUser));
                }
              }
            } else {
              // Token invalid, clear everything
              setUser(null);
              localStorage.removeItem("user");
            }
          } catch (error) {
            console.log("Token validation failed, trying refresh:", error.message);
            // Token invalid or expired, try refresh
            if (refreshToken) {
              try {
                await AuthApi.refreshToken();
                const currentUser = await AuthApi.getCurrentUser();
                if (currentUser) {
                  setUser(currentUser);
                  localStorage.setItem("user", JSON.stringify(currentUser));
                } else {
                  setUser(null);
                  localStorage.removeItem("user");
                }
              } catch (refreshError) {
                console.log("Refresh failed:", refreshError.message);
                // Refresh failed, clear everything
                setUser(null);
                localStorage.removeItem("user");
              }
            } else {
              // No refresh token, clear everything
              setUser(null);
              localStorage.removeItem("user");
            }
          }
        } else if (storedUser) {
          // No tokens but user stored - clear it
          localStorage.removeItem("user");
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        setUser(null);
        localStorage.removeItem("user");
      } finally {
        setLoading(false);
      }
    }

    initializeAuth();
  }, []);

  /**
   * Login function - updates context state
   */
  const login = useCallback((userData) => {
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
  }, []);

  /**
   * Logout function - clears everything
   */
  const logout = useCallback(async () => {
    try {
      await AuthApi.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      localStorage.removeItem("user");
    }
  }, []);

  /**
   * Refresh user data from backend
   */
  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await AuthApi.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
        localStorage.setItem("user", JSON.stringify(currentUser));
      }
    } catch (error) {
      console.error("Refresh user error:", error);
      // If refresh fails, user might be logged out
      setUser(null);
      localStorage.removeItem("user");
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
