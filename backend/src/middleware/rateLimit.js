function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

export function createRateLimiter({
  windowMs = 60_000,
  limit = 300,
  name = "api",
  maxKeys = 10_000
} = {}) {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = clientKey(req);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (buckets.size > maxKeys) {
      for (const [candidateKey, candidate] of buckets) {
        if (candidate.resetAt <= now) buckets.delete(candidateKey);
        if (buckets.size <= maxKeys) break;
      }
    }

    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Too many requests",
        message: "Request rate limit exceeded. Retry later.",
        code: "RATE_LIMITED",
        limiter: name
      });
    }

    next();
  };
}

export const apiRateLimit = createRateLimiter({
  windowMs: positiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
  limit: positiveInt(process.env.API_RATE_LIMIT_MAX, 300),
  name: "api"
});

const expensiveRateLimit = createRateLimiter({
  windowMs: positiveInt(process.env.EXPENSIVE_RATE_LIMIT_WINDOW_MS, 60_000),
  limit: positiveInt(process.env.EXPENSIVE_RATE_LIMIT_MAX, 30),
  name: "expensive"
});

const EXPENSIVE_PATTERNS = [
  /^\/documents\/(upload|smart-upload)(?:\/|$)/,
  /^\/claims\/[^/]+\/check(?:\/|$)/,
  /^\/claims\/[^/]+\/submit(?:\/|$)/,
  /^\/claims\/[^/]+\/journey\/(eligibility|prior-auth|claim-status|remittance)(?:\/|$)/,
  /^\/claims\/[^/]+\/payer-simulation\/(eligibility|prior-auth|submission|status|remittance)(?:\/|$)/
];

export function expensiveOperationRateLimit(req, res, next) {
  if (!EXPENSIVE_PATTERNS.some((pattern) => pattern.test(req.path))) {
    return next();
  }
  return expensiveRateLimit(req, res, next);
}
