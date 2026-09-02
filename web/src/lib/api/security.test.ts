import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enforcePersistentRateLimit,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { SharedRateLimitUnavailableError } from "@/lib/api/rate-limit";

const rateLimitMocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
}));

vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  checkSharedRateLimit: rateLimitMocks.checkSharedRateLimit,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

afterEach(() => {
  rateLimitMocks.checkSharedRateLimit.mockReset();
  vi.unstubAllEnvs();
});

describe("api security", () => {
  it("allows configured application origins", () => {
    vi.stubEnv("APP_URL", "https://app.example.com");

    const request = new Request("http://internal:3000/api/test", {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    });

    expect(requireSameOrigin(request)).toBeNull();
  });

  it("allows same-origin unsafe requests", () => {
    const request = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    expect(requireSameOrigin(request)).toBeNull();
  });

  it("rejects cross-origin unsafe requests", () => {
    const request = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(requireSameOrigin(request)?.status).toBe(403);
  });

  it("rejects unsafe requests without origin headers", () => {
    const request = new Request("http://localhost:3000/api/test", {
      method: "POST",
    });

    expect(requireSameOrigin(request)?.status).toBe(403);
  });

  it("allows forwarded origin behind a proxy", () => {
    vi.stubEnv("APP_URL", "https://app.example.com");

    const request = new Request("http://internal:3000/api/test", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(requireSameOrigin(request)).toBeNull();
  });

  it("rejects unconfigured forwarded origins when an app origin is configured", () => {
    vi.stubEnv("APP_URL", "https://app.example.com");

    const request = new Request("http://internal:3000/api/test", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(requireSameOrigin(request)?.status).toBe(403);
  });

  it("matches content type by media type instead of substring", () => {
    const validRequest = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    const invalidRequest = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "text/application/json" },
    });

    expect(requireContentType(validRequest, ["application/json"])).toBeNull();
    expect(requireContentType(invalidRequest, ["application/json"])?.status).toBe(
      415,
    );
  });

  it("rejects malformed content-length headers", () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-length": "NaN" },
    });

    expect(requireMaxContentLength(request, 1024)?.status).toBe(400);
  });

  it("enforces the real JSON body size when content-length is absent", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "1234567890" }),
    });
    request.headers.delete("content-length");

    expect(requireMaxContentLength(request, 8)).toBeNull();
    const result = await readJsonBody(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("parses JSON while enforcing its configured limit", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "ok" }),
    });

    expect(requireMaxContentLength(request, 1024)).toBeNull();
    const result = await readJsonBody(request);

    expect(result).toEqual({ ok: true, data: { value: "ok" } });
  });

  it("allows requests while the persistent bucket has capacity", async () => {
    rateLimitMocks.checkSharedRateLimit.mockResolvedValue({
      limited: false,
      remaining: 2,
      resetAt: Date.now() + 60_000,
    });

    const response = await enforcePersistentRateLimit(
      new Request("http://localhost/api/test"),
      { keyPrefix: "test", limit: 3, windowMs: 60_000 },
    );

    expect(response).toBeNull();
    expect(rateLimitMocks.checkSharedRateLimit).toHaveBeenCalledOnce();
  });

  it("returns retry guidance when the persistent bucket is exhausted", async () => {
    rateLimitMocks.checkSharedRateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });

    const response = await enforcePersistentRateLimit(
      new Request("http://localhost/api/test"),
      { keyPrefix: "test", limit: 3, windowMs: 60_000 },
    );

    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("fails closed when the persistent bucket is unavailable", async () => {
    rateLimitMocks.checkSharedRateLimit.mockRejectedValue(
      new SharedRateLimitUnavailableError({
        cause: new Error("database unavailable"),
      }),
    );

    const response = await enforcePersistentRateLimit(
      new Request("http://localhost/api/test"),
      { keyPrefix: "test", limit: 3, windowMs: 60_000 },
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("30");
  });
});
