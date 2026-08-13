import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceEvent: { findFirst: mocks.findFirst },
    presenceDelivery: { groupBy: mocks.groupBy },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ eventId: "event-1" }) };

describe("/api/admin/presencas/[eventId] route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: {
        id: "admin-1",
        tenantId: "tenant-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
      expires: "2026-09-01T00:00:00.000Z",
    });
    mocks.findFirst.mockResolvedValue({
      id: "event-1",
      eventSlug: "formatura",
      title: "Formatura",
      description: null,
      startsAt: new Date("2026-12-20T22:00:00.000Z"),
      confirmationDeadline: new Date("2026-12-01T02:59:59.000Z"),
      venueName: null,
      venueAddress: null,
      timeZone: "America/Sao_Paulo",
      status: "PUBLISHED",
      theme: null,
      publicRevision: 1,
      reminderAt: null,
      reminderProcessedAt: null,
      retentionUntil: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      guests: [
        {
          id: "guest-1",
          name: "Ana",
          email: null,
          guestSlug: "ana",
          rsvpStatus: "CONFIRMED",
          companionLimit: 2,
          companionCount: 1,
          accessExpiresAt: null,
          tokenRevokedAt: null,
          respondedAt: new Date("2026-08-10T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          deliveries: [],
          _count: { reservedGifts: 1 },
        },
      ],
      gifts: [
        {
          id: "gift-1",
          title: "Pratos",
          description: null,
          externalUrl: null,
          position: 0,
          active: true,
          reservedAt: new Date("2026-08-10T00:00:00.000Z"),
          reservedByGuest: { id: "guest-1", name: "Ana" },
        },
      ],
      _count: { guests: 1, gifts: 1, deliveries: 1 },
    });
    mocks.groupBy.mockResolvedValue([
      { status: "DELIVERED", _count: { _all: 1 } },
    ]);
  });

  it("returns tenant-scoped event analytics and a safe legacy theme", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/presencas/event-1"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analytics).toEqual(
      expect.objectContaining({
        responseRate: 100,
        rsvp: expect.objectContaining({ expectedAttendance: 2 }),
        gifts: { active: 1, reserved: 1 },
        deliveries: { DELIVERED: 1 },
      }),
    );
    expect(body.theme).toEqual(
      expect.objectContaining({ preset: "CELEBRATION", accent: "CORAL" }),
    );
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-1", tenantId: "tenant-1" } }),
    );
  });
});
