const windows = new Map();

function requestKey(req) {
  const user = req.user?.id ? `user:${req.user.id}` : null;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return user || `ip:${ip}`;
}

function isExpensivePath(req) {
  const path = String(req.originalUrl || req.path || "");
  return (
    /\/process(?:\?|$)/.test(path) ||
    /\/check(?:\?|$)/.test(path) ||
    /eligibility|remittance|claim-status|submit/.test(path)
  );
}

export function apiRateLimit({
  windowMs = 15 * 60 * 1000,
  maxRequests = 600,
  maxExpensiveRequests = 120
} = {}) {
  return (req, res, next) => {
    if (!String(req.path || "").startsWith("/api") && !String(req.originalUrl || "").startsWith("/api")) {
      return next();
    }

    const now = Date.now();
    const key = requestKey(req);
    const bucketKey = `${key}:${isExpensivePath(req) ? "expensive" : "general"}`;
    const limit = isExpensivePath(req) ? maxExpensiveRequests : maxRequests;
    let record = windows.get(bucketKey);

    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      windows.set(bucketKey, record);
    }

    record.count += 1;
    const remaining = Math.max(0, limit - record.count);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)));

    if (record.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests",
        message: "Request rate limit exceeded. Please retry later.",
        code: "API_RATE_LIMITED",
        retryAfter
      });
    }

    // Opportunistic cleanup keeps this bounded without a background timer.
    if (windows.size > 5000 && Math.random() < 0.02) {
      for (const [candidateKey, candidate] of windows.entries()) {
        if (candidate.resetAt <= now) windows.delete(candidateKey);
      }
    }

    next();
  };
}
