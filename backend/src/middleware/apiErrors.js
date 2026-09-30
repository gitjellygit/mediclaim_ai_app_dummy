/** Keep existing error strings for clients while supplying a stable API contract. */
export function standardizeApiErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (payload) {
    if (res.statusCode < 400 || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return originalJson(payload);
    }
    const fallback = res.statusCode >= 500 ? "Internal server error" : "Request failed";
    const error = typeof payload.error === "string" ? payload.error : fallback;
    const code = typeof payload.code === "string" ? payload.code :
      res.statusCode === 400 ? "BAD_REQUEST" :
      res.statusCode === 401 ? "UNAUTHORIZED" :
      res.statusCode === 403 ? "FORBIDDEN" :
      res.statusCode === 404 ? "NOT_FOUND" :
      res.statusCode === 409 ? "CONFLICT" :
      res.statusCode === 413 ? "FILE_TOO_LARGE" :
      res.statusCode === 415 ? "UNSUPPORTED_FILE" :
      res.statusCode === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR";
    return originalJson({ ...payload, error, message: typeof payload.message === "string" ? payload.message : error, code });
  };
  next();
}
