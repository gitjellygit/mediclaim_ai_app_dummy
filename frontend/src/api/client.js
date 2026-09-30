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

function authEndpoint(url) {
  const pathname = new URL(url, API_BASE_URL).pathname;
  return ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"].includes(pathname);
}

function asApiError(response, data) {
  const message = data?.message || data?.error || `Request failed: ${response.status}`;
  const error = new Error(message);
  error.status = response.status;
  error.statusText = response.statusText;
  error.code = data?.code || null;
  error.data = data;
  return error;
}

export async function api(url, options = {}) {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
  const isAuth = authEndpoint(fullUrl);
  // Proactive refresh is only for protected requests. In particular, an
  // invalid password must NEVER cause an automatic logout or login redirect.
  if (!isAuth && getRefreshToken()) {
    await refreshTokenIfNeeded().catch(() => null);
  }

  async function send(token) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && typeof options.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    return fetch(fullUrl, { ...options, headers });
  }

  let response = await send(getToken());
  if (response.status === 401 && !isAuth && getRefreshToken()) {
    // Refresh at most once, then retry the original request once. For mutating
    // requests the retry happens only after the first response was explicitly
    // rejected as unauthorized (no mutation was accepted).
    try {
      const nextToken = await refreshTokenIfNeeded();
      if (nextToken) response = await send(nextToken);
    } catch {
      // Fall through to the normal structured 401 handling.
    }
  }

  if (!response.ok) {
    let data;
    try { data = await response.json(); }
    catch { data = null; }
    if (response.status === 401 && !isAuth) {
      clearTokens();
      // Preserve normal error semantics so protected-route UI can redirect.
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    throw asApiError(response, data);
  }

  if (response.status === 204) return null;
  return response.json();
}
