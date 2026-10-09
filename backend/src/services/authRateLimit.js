const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export async function checkAuthRateLimit(
  prisma,
  key,
  maxAttempts,
  windowMs = DEFAULT_WINDOW_MS
) {
  const now = new Date();
  const record = await prisma.authRateLimit.findUnique({ where: { key } });

  if (!record || record.resetAt <= now) {
    if (record) {
      await prisma.authRateLimit.deleteMany({
        where: { key, resetAt: { lte: now } }
      });
    }
    return {
      allowed: true,
      remaining: maxAttempts,
      resetAt: new Date(now.getTime() + windowMs)
    };
  }

  return {
    allowed: record.count < maxAttempts,
    remaining: Math.max(0, maxAttempts - record.count),
    resetAt: record.resetAt
  };
}

export async function recordAuthFailure(
  prisma,
  key,
  windowMs = DEFAULT_WINDOW_MS
) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  return prisma.$transaction(async (tx) => {
    await tx.authRateLimit.deleteMany({
      where: { key, resetAt: { lte: now } }
    });

    return tx.authRateLimit.upsert({
      where: { key },
      create: {
        key,
        count: 1,
        windowStartedAt: now,
        resetAt
      },
      update: {
        count: { increment: 1 }
      }
    });
  });
}

export async function clearAuthRateLimit(prisma, key) {
  await prisma.authRateLimit.deleteMany({ where: { key } });
}

export async function purgeExpiredAuthRateLimits(prisma, now = new Date()) {
  return prisma.authRateLimit.deleteMany({
    where: { resetAt: { lte: now } }
  });
}
