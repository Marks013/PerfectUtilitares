import { describe, expect, it } from "vitest";
import { getClientIp, getRateLimitKey } from "@/lib/api/rate-limit";

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
