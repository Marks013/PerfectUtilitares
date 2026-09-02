import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const { authMock, deliverMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  deliverMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/presence/delivery", () => ({
  deliverPresenceInvitations: deliverMock,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const routePath = "/api/admin/presencas/event-1/entregas";
const context = { params: Promise.resolve({ eventId: "event-1" }) };

describe("presence delivery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_URL", "https://perfect.example.test");
    authMock.mockResolvedValue({
      user: { id: "admin-1", tenantId: "tenant-1", role: "ADMIN", status: "ACTIVE" },
      expires: "2026-09-01T00:00:00.000Z",
    });
  });

  it("delivers a validated guest selection for the administrator tenant", async () => {
    deliverMock.mockResolvedValue({
      kind: "OK",
      results: [{ deliveryId: "delivery-1", guestId: "guest-1", status: "SENT" }],
    });
    const response = await POST(
      new Request(`https://perfect.example.test${routePath}`, {
        method: "POST",
        headers: { origin: "https://perfect.example.test", "content-type": "application/json" },
        body: JSON.stringify({ requestId: "123e4567-e89b-12d3-a456-426614174000", guestIds: ["cm12345678901234567890123"] }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(deliverMock).toHaveBeenCalledWith({
      eventId: "event-1",
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      guestIds: ["cm12345678901234567890123"],
      requestId: "123e4567-e89b-12d3-a456-426614174000",
      baseUrl: "https://perfect.example.test",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    { method: "GET", handler: GET },
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(handler as unknown as TestRouteHandler, method, routePath, "POST");
  });
});
