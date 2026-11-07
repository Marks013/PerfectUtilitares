import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  checkSharedRateLimit,
  getClientIp,
  getHashedRateLimitKey,
  getRateLimitKey,
  SharedRateLimitUnavailableError,
} from "@/lib/api/rate-limit";

const prisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  apiRateLimitBucket: { deleteMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClientIp", () => {
  it("prefers the IP set by the trusted reverse proxy", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.20, 10.0.0.8",
      "x-real-ip": "203.0.113.15",
    });

    expect(getClientIp(headers)).toBe("203.0.113.15");
  });

  it("uses the last forwarded hop when x-real-ip is absent", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.20, 203.0.113.15",
    });

    expect(getClientIp(headers)).toBe("203.0.113.15");
  });

  it("falls back to a stable local bucket", () => {
    expect(getClientIp(new Headers())).toBe("local");
  });

  it("rejects malformed proxy values", () => {
    const headers = new Headers({
      "x-forwarded-for": "not-an-ip",
      "x-real-ip": "anything-the-client-wants",
    });

    expect(getClientIp(headers)).toBe("local");
  });

  it("does not persist the raw IP in rate-limit keys", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.15" });
    const key = getRateLimitKey("photos", headers);

    expect(key).toMatch(/^photos:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.15");
  });
});

describe("checkSharedRateLimit", () => {
  it("fails closed when the shared PostgreSQL bucket is unavailable", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"));

    await expect(
      checkSharedRateLimit("pdf:test", { limit: 2, windowMs: 60_000 }),
    ).rejects.toBeInstanceOf(SharedRateLimitUnavailableError);
  });
});

describe("rate-limit secret boundary", () => {
  it("expires the account cooldown without changing recovery or login state", () => {
    vi.useFakeTimers();
    try {
      const key = getHashedRateLimitKey("account-window-test", "user@example.test");
      expect(checkRateLimit(key, { limit: 1, windowMs: 15 * 60_000 }).limited).toBe(false);
      expect(checkRateLimit(key, { limit: 1, windowMs: 15 * 60_000 }).limited).toBe(true);
      vi.advanceTimersByTime(15 * 60_000);
      expect(checkRateLimit(key, { limit: 1, windowMs: 15 * 60_000 }).limited).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("does not use a public fallback in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    try { expect(() => getHashedRateLimitKey("login-account", "user@example.test")).toThrow(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("separates account recovery and login without storing email", () => {
    const login = getHashedRateLimitKey("login-account", "user@example.test");
    const recovery = getHashedRateLimitKey("password-reset-account", "user@example.test");
    expect(login).not.toBe(recovery);
    expect(recovery).not.toContain("user@example.test");
  });
});
