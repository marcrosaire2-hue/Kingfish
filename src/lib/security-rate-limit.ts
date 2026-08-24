import { getDb } from "@/lib/mongodb";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSec: number;
  count: number;
  windowStart: number;
};

export function evaluateRateLimit(input: {
  count: number;
  windowStart: number;
  now: number;
  limit: number;
  windowMs: number;
}): RateLimitDecision {
  const expired = input.now - input.windowStart >= input.windowMs;
  const windowStart = expired ? input.now : input.windowStart;
  const count = expired ? 1 : input.count + 1;
  const allowed = count <= input.limit;
  const retryAfterSec = allowed
    ? 0
    : Math.max(
        1,
        Math.ceil((windowStart + input.windowMs - input.now) / 1000),
      );
  return { allowed, retryAfterSec, count, windowStart };
}

type RateDoc = {
  _id: string;
  count: number;
  windowStart: number;
  expiresAt: Date;
};

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  const db = await getDb();
  const col = db.collection<RateDoc>("rate_limits");
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const now = Date.now();
  const existing = await col.findOne({ _id: input.key });
  const next = evaluateRateLimit({
    count: existing?.count ?? 0,
    windowStart: existing?.windowStart ?? now,
    now,
    limit: input.limit,
    windowMs: input.windowMs,
  });
  await col.updateOne(
    { _id: input.key },
    {
      $set: {
        count: next.count,
        windowStart: next.windowStart,
        expiresAt: new Date(next.windowStart + input.windowMs),
      },
    },
    { upsert: true },
  );
  return next;
}

export function rateLimitResponse(retryAfterSec: number) {
  return {
    error: "Trop de requêtes. Réessayez plus tard.",
    retryAfter: retryAfterSec,
  };
}
