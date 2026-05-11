import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

afterEach(() => {
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
});
