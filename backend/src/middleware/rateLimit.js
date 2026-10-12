const DEFAULT_WINDOW_MS = 60_000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createMemoryRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = 300,
  code = "RATE_LIMITED",
  shouldLimit = () => true
} = {}) {
  const windowLength = positiveNumber(windowMs, DEFAULT_WINDOW_MS);
  const requestLimit = Math.floor(positiveNumber(max, 300));
  const buckets = new Map();

  return function memoryRateLimit(req, res, next) {
    if (!shouldLimit(req)) return next();

    const now = Date.now();
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowLength });
      return next();
    }

    current.count += 1;
    if (current.count <= requestLimit) return next();

    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      error: "Too many requests",
      message: "Request rate limit exceeded. Retry after the current window resets.",
      code
    });
  };
}
