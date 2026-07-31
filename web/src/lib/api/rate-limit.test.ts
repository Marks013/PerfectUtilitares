import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSharedRateLimit,
  getClientIp,
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
