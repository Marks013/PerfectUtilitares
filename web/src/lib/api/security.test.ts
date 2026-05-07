import { describe, expect, it, vi } from "vitest";
import { requireSameOrigin } from "@/lib/api/security";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

describe("api security", () => {
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
});
