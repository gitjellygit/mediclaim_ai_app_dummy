const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * Token management
 */
export function setToken(token) {
  if (token) {
    localStorage.setItem("accessToken", token);
  } else {
    localStorage.removeItem("accessToken");
  }
}

export function getToken() {
  return localStorage.getItem("accessToken");
}

export function setRefreshToken(token) {
  if (token) {
    localStorage.setItem("refreshToken", token);
  } else {
    localStorage.removeItem("refreshToken");
  }
}

export function getRefreshToken() {
  return localStorage.getItem("refreshToken");
}

export function clearTokens() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

/**
 * Check if token is expired (with 1 minute buffer)
 */
function isTokenExpired(token) {
  if (!token) return true;
  
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const buffer = 60 * 1000; // 1 minute buffer
    
    return exp - buffer < now;
  } catch {
    return true;
  }
}

/**
 * Enhanced API client with automatic token refresh
 */
let refreshPromise = null;

async function refreshTokenIfNeeded() {
  const token = getToken();
  const refreshToken = getRefreshToken();

  // If no tokens, nothing to refresh
  if (!token && !refreshToken) {
    return null;
  }

  // If token is still valid, no need to refresh
  if (token && !isTokenExpired(token)) {
    return token;
  }

  // If refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start refresh
  refreshPromise = (async () => {
    try {
      const { AuthApi } = await import("./auth.js");
      const newToken = await AuthApi.refreshToken();
      return newToken;
    } catch (error) {
      // Refresh failed - clear tokens
      clearTokens();
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function api(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  
  // Set Content-Type for JSON requests
  if (options.body && typeof options.body === 'string') {
    headers.set("Content-Type", "application/json");
  }

  const fullUrl = url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
  const res = await fetch(fullUrl, { ...options, headers });

  if (res.status === 401) {
    // 🔥 auto logout on token failure
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    window.location.href = "/login";
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    let errorMessage = text || `Request failed: ${res.status}`;
    
    // Try to parse as JSON for better error messages
    try {
      const errorJson = JSON.parse(text);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
    } catch {
      // Not JSON, use text as-is
    }
    
    // Create error with status code for better handling
    const error = new Error(errorMessage);
    error.status = res.status;
    error.statusText = res.statusText;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}