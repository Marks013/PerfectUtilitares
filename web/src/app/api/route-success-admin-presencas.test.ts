import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  eventFindFirst: vi.fn(), eventUpdate: vi.fn(), eventDelete: vi.fn(),
  guestFindFirst: vi.fn(), guestUpdate: vi.fn(), guestDelete: vi.fn(),
  sessionUpdateMany: vi.fn(),
  giftAggregate: vi.fn(), giftCreate: vi.fn(), giftCount: vi.fn(), giftUpdate: vi.fn(), giftFindFirst: vi.fn(), giftDelete: vi.fn(),
  activityCreate: vi.fn(), transaction: vi.fn(),
  deliveryGroupBy: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceEvent: { findFirst: mocks.eventFindFirst, update: mocks.eventUpdate, delete: mocks.eventDelete },
    presenceGuest: { findFirst: mocks.guestFindFirst, update: mocks.guestUpdate, delete: mocks.guestDelete },
    presenceGuestSession: { updateMany: mocks.sessionUpdateMany },
    presenceGift: { aggregate: mocks.giftAggregate, create: mocks.giftCreate, count: mocks.giftCount, update: mocks.giftUpdate, findFirst: mocks.giftFindFirst, delete: mocks.giftDelete },
    presenceActivity: { create: mocks.activityCreate },
    presenceDelivery: { groupBy: mocks.deliveryGroupBy },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/presence/tokens", () => ({
  generatePresenceInvitationToken: () => `c_${"a".repeat(43)}`,
  generatePresenceShortCode: () => `p_${"b".repeat(16)}`,
  hashPresenceSecret: () => "token-hash",
}));

import * as eventRoute from "./admin/presencas/[eventId]/route";
import * as guestRoute from "./admin/presencas/[eventId]/convidados/[guestId]/route";
import * as linkRoute from "./admin/presencas/[eventId]/convidados/[guestId]/renovar-link/route";
import * as giftsRoute from "./admin/presencas/[eventId]/presentes/route";
import * as giftRoute from "./admin/presencas/[eventId]/presentes/[giftId]/route";

const session = { user: { id: "admin-1", tenantId: "tenant-1", role: "ADMIN", status: "ACTIVE", email: "admin@example.com", name: "Admin" } };
const context = { params: Promise.resolve({ eventId: "event-1", guestId: "guest-1", giftId: "gift-1" }) };

describe("route-success: admin presencas fase 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
    mocks.activityCreate.mockResolvedValue({ id: "activity-1" });
    mocks.deliveryGroupBy.mockResolvedValue([]);
  });

  const routeCases = [
    { route: "src/app/api/admin/presencas/[eventId]/route.ts", expectedStatus: 200 },
    { route: "src/app/api/admin/presencas/[eventId]/convidados/[guestId]/route.ts", expectedStatus: 200 },
    { route: "src/app/api/admin/presencas/[eventId]/convidados/[guestId]/renovar-link/route.ts", expectedStatus: 200 },
    { route: "src/app/api/admin/presencas/[eventId]/presentes/route.ts", expectedStatus: 201 },
    { route: "src/app/api/admin/presencas/[eventId]/presentes/[giftId]/route.ts", expectedStatus: 200 },
  ] as const;

  it.each(routeCases)("returns 2xx for $route", async (routeCase) => {
    let response: Response;
    if (routeCase.route.endsWith("presencas/[eventId]/route.ts")) {
      mocks.eventFindFirst.mockResolvedValue({ id: "event-1", eventSlug: "evento", title: "Evento", description: null, startsAt: new Date(), confirmationDeadline: new Date(), venueName: null, venueAddress: null, timeZone: "America/Sao_Paulo", status: "DRAFT", publicRevision: 0, createdAt: new Date(), updatedAt: new Date(), guests: [], gifts: [], _count: { guests: 0, gifts: 0, deliveries: 0 } });
      response = await eventRoute.GET(new Request("http://localhost/api/admin/presencas/event-1"), context);
    } else if (routeCase.route.includes("renovar-link")) {
      mocks.guestFindFirst.mockResolvedValue({ id: "guest-1", guestSlug: "ana", event: { eventSlug: "evento" } });
      mocks.guestUpdate.mockResolvedValue({}); mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
      response = await linkRoute.POST(new Request("http://localhost/api/admin/presencas/event-1/convidados/guest-1/renovar-link", { method: "POST", headers: { origin: "http://localhost" } }), context);
    } else if (routeCase.route.includes("convidados/[guestId]")) {
      mocks.guestFindFirst.mockResolvedValue({ id: "guest-1", eventId: "event-1", companionLimit: 2, companionCount: 0, rsvpStatus: "PENDING" });
      mocks.guestUpdate.mockResolvedValue({ id: "guest-1", name: "Ana", email: null, guestSlug: "ana", rsvpStatus: "CONFIRMED", companionLimit: 2, companionCount: 0, accessExpiresAt: null, tokenRevokedAt: null, respondedAt: new Date() });
      response = await guestRoute.PATCH(new Request("http://localhost/api/admin/presencas/event-1/convidados/guest-1", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ rsvpStatus: "CONFIRMED", companionCount: 0 }) }), context);
    } else if (routeCase.route.endsWith("presentes/route.ts")) {
      mocks.eventFindFirst.mockResolvedValue({ id: "event-1" }); mocks.giftAggregate.mockResolvedValue({ _max: { position: 1 } });
      mocks.giftCreate.mockResolvedValue({ id: "gift-1", title: "Presente", description: null, externalUrl: null, position: 2, active: true });
      response = await giftsRoute.POST(new Request("http://localhost/api/admin/presencas/event-1/presentes", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ title: "Presente", active: true }) }), context);
    } else {
      mocks.giftFindFirst.mockResolvedValue({ id: "gift-1", reservedByGuestId: null });
      mocks.giftUpdate.mockResolvedValue({ id: "gift-1", title: "Presente", description: null, externalUrl: null, position: 0, active: false, reservedAt: null, reservedByGuest: null });
      response = await giftRoute.PATCH(new Request("http://localhost/api/admin/presencas/event-1/presentes/gift-1", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ active: false }) }), context);
    }
    expect(response.status).toBe(routeCase.expectedStatus);
  });

  it("scopes event details to the administrator tenant", async () => {
    mocks.eventFindFirst.mockResolvedValue(null);
    const response = await eventRoute.GET(
      new Request("http://localhost/api/admin/presencas/event-other"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "event-1", tenantId: "tenant-1" },
      }),
    );
  });

  it("rejects an unsafe archived-to-published transition", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      id: "event-1",
      startsAt: new Date("2026-12-20T18:00:00-03:00"),
      confirmationDeadline: new Date("2026-12-10T18:00:00-03:00"),
      status: "ARCHIVED",
    });
    const response = await eventRoute.PATCH(
      new Request("http://localhost/api/admin/presencas/event-1", {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ status: "PUBLISHED" }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.eventUpdate).not.toHaveBeenCalled();
  });

  it("returns method contracts for unsupported operations", async () => {
    const responses = [
      eventRoute.POST(),
      guestRoute.GET(),
      guestRoute.POST(),
      linkRoute.GET(),
      linkRoute.PATCH(),
      linkRoute.DELETE(),
      giftsRoute.GET(),
      giftsRoute.DELETE(),
      giftRoute.GET(),
      giftRoute.POST(),
    ];

    for (const response of responses) expect(response.status).toBe(405);
  });
});
