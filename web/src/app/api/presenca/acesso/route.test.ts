import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const { exchangePresenceAccessMock } = vi.hoisted(() => ({
  exchangePresenceAccessMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/presence/access", () => ({
  exchangePresenceAccess: exchangePresenceAccessMock,
}));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
}));

import { GET, POST } from "./route";

const routePath = "/api/presenca/acesso";

describe("/api/presenca/acesso route", () => {
  beforeEach(() => {
    exchangePresenceAccessMock.mockReset();
  });

  it("creates an opaque guest session for a valid invitation", async () => {
    exchangePresenceAccessMock.mockResolvedValue({
      cookieName: "pu-presence-test",
      sessionToken: `s_${"a".repeat(43)}`,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventSlug: "casamento-ana-e-joao",
          guestSlug: "maico-rafael",
          token: `c_${"b".repeat(43)}`,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(
      "pu-presence-test=s_",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(exchangePresenceAccessMock).toHaveBeenCalledOnce();
  });

  it("rejects POST requests without a trusted origin", async () => {
    await expectOriginRequired(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it("returns 405 for GET requests", async () => {
    await expectMethodNotAllowed(
      GET as unknown as TestRouteHandler,
      "GET",
      routePath,
      "POST",
    );
  });
});
