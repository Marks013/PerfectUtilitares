import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  guestFind: vi.fn(),
  guestUpdate: vi.fn(),
  eventUpdate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceGuest: {
      findFirst: mocks.guestFind,
      update: mocks.guestUpdate,
      delete: vi.fn(),
    },
    presenceEvent: { update: mocks.eventUpdate },
    presenceActivity: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));

import { PATCH } from "./route";

const context = {
  params: Promise.resolve({ eventId: "event-1", guestId: "guest-1" }),
};

describe("admin presence guest route", () => {
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
    mocks.guestFind.mockResolvedValue({
      id: "guest-1",
      eventId: "event-1",
      companionLimit: 2,
      companionCount: 0,
      rsvpStatus: "PENDING",
    });
    mocks.guestUpdate.mockReturnValue({ operation: "guest-update" });
    mocks.eventUpdate.mockReturnValue({ operation: "event-update" });
    mocks.transaction.mockResolvedValue([
      {
        id: "guest-1",
        name: "Ana",
        email: "ana@example.com",
        guestSlug: "ana",
        rsvpStatus: "CONFIRMED",
        companionLimit: 2,
        companionCount: 1,
      },
      { id: "event-1" },
    ]);
  });

  it("updates the guest and public revision atomically", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/presencas/event-1/convidados/guest-1", {
        method: "PATCH",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ rsvpStatus: "CONFIRMED", companionCount: 1 }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith([
      { operation: "guest-update" },
      { operation: "event-update" },
    ]);
    expect(mocks.eventUpdate).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { publicRevision: { increment: 1 } },
    });
  });

  it("rejects declined invitations with companions", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/presencas/event-1/convidados/guest-1", {
        method: "PATCH",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ rsvpStatus: "DECLINED", companionCount: 1 }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
