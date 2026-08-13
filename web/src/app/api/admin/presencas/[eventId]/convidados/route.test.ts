import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const { authMock, eventFindMock, guestCreateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  eventFindMock: vi.fn(),
  guestCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceEvent: { findFirst: eventFindMock },
    presenceGuest: { create: guestCreateMock },
  },
}));
vi.mock("@/lib/presence/tokens", () => ({
  generatePresenceInvitationToken: () => `c_${"a".repeat(43)}`,
  generatePresenceShortCode: () => `p_${"b".repeat(16)}`,
  hashPresenceSecret: () => "hashed-invitation-token",
}));

import { DELETE, GET, PATCH, POST } from "./route";

const routePath = "/api/admin/presencas/event-1/convidados";
const context = { params: Promise.resolve({ eventId: "event-1" }) };

describe("/api/admin/presencas/[eventId]/convidados route", () => {
  beforeEach(() => {
    authMock.mockReset();
    eventFindMock.mockReset();
    guestCreateMock.mockReset();
    authMock.mockResolvedValue({
      user: {
        id: "user-admin",
        tenantId: "tenant-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
      expires: "2026-09-01T00:00:00.000Z",
    });
  });

  it("creates a guest and returns the readable one-time invitation link", async () => {
    eventFindMock.mockResolvedValue({
      id: "event-1",
      eventSlug: "formatura-2026",
      startsAt: new Date("2026-12-20T22:00:00.000Z"),
    });
    guestCreateMock.mockResolvedValue({
      id: "guest-1",
      name: "Ana Souza",
      email: "ana@example.com",
      guestSlug: "ana-souza",
      companionLimit: 1,
      accessExpiresAt: new Date("2026-12-21T22:00:00.000Z"),
    });

    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Ana Souza",
          email: " ANA@EXAMPLE.COM ",
          guestSlug: "ana-souza",
          companionLimit: 1,
        }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invitationUrl).toBe(
      `http://localhost/presenca/formatura-2026/ana-souza#c_${"a".repeat(43)}`,
    );
    expect(guestCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-1",
          email: "ana@example.com",
          tokenHash: "hashed-invitation-token",
        }),
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not reveal events from another tenant", async () => {
    eventFindMock.mockResolvedValue(null);

    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Ana Souza", guestSlug: "ana-souza" }),
      }),
      context,
    );

    expect(response.status).toBe(404);
    expect(eventFindMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "event-1", tenantId: "tenant-1" },
      }),
    );
    expect(guestCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    { method: "GET", handler: GET },
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      "POST",
    );
  });
});
