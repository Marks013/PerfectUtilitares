import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;
let sharedChecks = 0;

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export class SharedRateLimitUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The shared rate-limit store is unavailable", options);
    this.name = "SharedRateLimitUnavailableError";
  }
}

export function getClientIp(headers: Headers) {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) {
    return realIp;
  }

  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const forwardedIp = forwarded?.at(-1);
  return forwardedIp && isIP(forwardedIp) ? forwardedIp : "local";
}

export function getHashedRateLimitKey(prefix: string, identifier: string) {
  const identifierHash = createHmac(
    "sha256",
    process.env.AUTH_SECRET || "perfectutilitares-local-rate-limit",
  )
    .update(identifier)
    .digest("hex");
  return `${prefix}:${identifierHash}`;
}

export function getRateLimitKey(prefix: string, headers: Headers) {
  return getHashedRateLimitKey(prefix, getClientIp(headers));
}

export function checkRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now();
  pruneBuckets(now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return {
      limited: false,
      remaining: options.limit - 1,
      resetAt: now + options.windowMs,
    };
  }

  bucket.count += 1;

  return {
    limited: bucket.count > options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export async function checkSharedRateLimit(
  key: string,
  options: RateLimitOptions,
) {
  const now = new Date();
  const nextReset = new Date(now.getTime() + options.windowMs);

  try {
    const [bucket] = await prisma.$queryRaw<
      Array<{ count: number; resetAt: Date }>
    >`
      INSERT INTO "ApiRateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${nextReset}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "ApiRateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "ApiRateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "ApiRateLimitBucket"."resetAt" <= ${now} THEN ${nextReset}
          ELSE "ApiRateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;

    sharedChecks += 1;
    if (sharedChecks % 500 === 0) {
      await prisma.$executeRaw`
        DELETE FROM "ApiRateLimitBucket"
        WHERE "key" IN (
          SELECT "key"
          FROM "ApiRateLimitBucket"
          WHERE "resetAt" < ${now}
          ORDER BY "resetAt" ASC
          LIMIT 500
        )
      `;
    }

    if (!bucket) {
      return checkRateLimit(key, options);
    }

    return {
      limited: bucket.count > options.limit,
      remaining: Math.max(0, options.limit - bucket.count),
      resetAt: bucket.resetAt.getTime(),
    };
  } catch (error) {
    throw new SharedRateLimitUnavailableError({ cause: error });
  }
}

function pruneBuckets(now: number) {
  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) {
      break;
    }
    buckets.delete(oldest.value);
  }
}
