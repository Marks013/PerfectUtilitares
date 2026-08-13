import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const { authMock, retryMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  retryMock: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/presence/delivery", () => ({ retryPresenceInvitation: retryMock }));

import { DELETE, GET, PATCH, POST } from "./route";

const routePath = "/api/admin/presencas/event-1/entregas/delivery-1/reenviar";
const context = { params: Promise.resolve({ eventId: "event-1", deliveryId: "delivery-1" }) };

describe("presence delivery retry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_URL", "https://perfect.example.test");
    authMock.mockResolvedValue({
      user: { id: "admin-1", tenantId: "tenant-1", role: "ADMIN", status: "ACTIVE" },
      expires: "2026-09-01T00:00:00.000Z",
    });
  });

  it("retries one failed tenant-owned delivery", async () => {
    retryMock.mockResolvedValue({ kind: "OK", result: { deliveryId: "delivery-1", guestId: "guest-1", status: "SENT" } });
    const response = await POST(
      new Request(`https://perfect.example.test${routePath}`, { method: "POST", headers: { origin: "https://perfect.example.test" } }),
      context,
    );
    expect(response.status).toBe(200);
    expect(retryMock).toHaveBeenCalledWith({
      eventId: "event-1",
      deliveryId: "delivery-1",
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      baseUrl: "https://perfect.example.test",
    });
  });

  it.each([
    { method: "GET", handler: GET },
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(handler as unknown as TestRouteHandler, method, routePath, "POST");
  });
});
