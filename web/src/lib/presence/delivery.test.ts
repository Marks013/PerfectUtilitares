import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverPresenceInvitations,
  processDuePresenceReminders,
  retryPresenceInvitation,
} from "@/lib/presence/delivery";

const mocks = vi.hoisted(() => {
  const prisma = {
    presenceEvent: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    presenceDelivery: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    presenceGuest: { update: vi.fn() },
    presenceGuestSession: { updateMany: vi.fn() },
    presenceActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, send: vi.fn(), captureMessage: vi.fn() };
});

vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.captureMessage }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/email/resend", () => ({
  sendPresenceInvitationEmail: mocks.send,
  sendPresenceReminderEmail: mocks.send,
}));
vi.mock("@/lib/presence/tokens", () => ({
  derivePresenceInvitationToken: () => `c_${"a".repeat(43)}`,
  derivePresenceShortCode: () => `p_${"b".repeat(16)}`,
  hashPresenceSecret: () => "hashed-token",
}));

const event = {
  id: "event-1",
  status: "PUBLISHED",
  confirmationDeadline: new Date("2099-01-01T00:00:00Z"),
  guests: [{ id: "guest-1", email: "guest@example.test" }],
};
const delivery = {
  id: "delivery-1",
  eventId: "event-1",
  guestId: "guest-1",
  idempotencyKey: "invite:request-1:guest-1",
  kind: "INVITATION",
  status: "SENDING",
  attemptCount: 1,
  guest: {
    id: "guest-1",
    name: "Ana",
    email: "guest@example.test",
    guestSlug: "ana",
  },
  event: {
    eventSlug: "formatura",
    title: "Formatura",
    startsAt: new Date("2098-12-20T22:00:00Z"),
    venueName: "Salão",
    timeZone: "America/Sao_Paulo",
  },
};

describe("presence invitation delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "test-secret");
    mocks.prisma.presenceEvent.findFirst.mockResolvedValue(event);
    mocks.prisma.presenceEvent.findMany.mockResolvedValue([]);
    mocks.prisma.presenceEvent.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.presenceDelivery.upsert.mockResolvedValue({ id: "delivery-1" });
    mocks.prisma.presenceDelivery.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.presenceDelivery.findUnique.mockResolvedValue(delivery);
    mocks.prisma.presenceDelivery.update.mockResolvedValue({});
    mocks.prisma.presenceGuest.update.mockReturnValue({ operation: "guest-update" });
    mocks.prisma.presenceGuestSession.updateMany.mockReturnValue({ operation: "session-update" });
    mocks.prisma.$transaction.mockResolvedValue([]);
    mocks.prisma.presenceActivity.create.mockResolvedValue({});
    mocks.send.mockResolvedValue("provider-message-1");
  });

  it("sends and persists the provider result without storing the raw token", async () => {
    const result = await deliverPresenceInvitations({
      eventId: "event-1",
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      guestIds: ["guest-1"],
      requestId: "request-1",
      baseUrl: "https://perfect.example.test",
    });

    expect(result).toMatchObject({ kind: "OK", results: [{ status: "SENT" }] });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "guest@example.test",
        idempotencyKey: "presence/delivery-1",
        inviteUrl: `https://perfect.example.test/p/p_${"b".repeat(16)}`,
      }),
    );
    expect(mocks.prisma.presenceDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", providerMessageId: "provider-message-1" }),
      }),
    );
  });

  it("does not resend a delivery already confirmed by the provider", async () => {
    mocks.prisma.presenceDelivery.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.presenceDelivery.findUnique.mockResolvedValue({ ...delivery, status: "DELIVERED" });

    const result = await deliverPresenceInvitations({
      eventId: "event-1",
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      guestIds: ["guest-1", "guest-1"],
      requestId: "request-1",
      baseUrl: "https://perfect.example.test",
    });

    expect(result).toMatchObject({ kind: "OK", results: [{ status: "SENT", reason: "ALREADY_SENT" }] });
    expect(mocks.prisma.presenceDelivery.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records a retryable failure without leaking the provider payload", async () => {
    mocks.send.mockRejectedValue(new Error("sensitive provider detail"));

    const result = await deliverPresenceInvitations({
      eventId: "event-1",
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      guestIds: ["guest-1"],
      requestId: "request-1",
      baseUrl: "https://perfect.example.test",
    });

    expect(result).toMatchObject({ kind: "OK", results: [{ status: "FAILED" }] });
    expect(mocks.prisma.presenceDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastErrorCode: "DELIVERY_FAILED",
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "Presence email delivery failed",
      expect.objectContaining({
        tags: expect.objectContaining({ errorCode: "DELIVERY_FAILED" }),
      }),
    );
  });

  it("rejects retries for deliveries outside the administrator tenant", async () => {
    mocks.prisma.presenceDelivery.findFirst.mockResolvedValue(null);
    await expect(
      retryPresenceInvitation({
        eventId: "event-1",
        deliveryId: "delivery-1",
        tenantId: "tenant-other",
        actorUserId: "admin-1",
        baseUrl: "https://perfect.example.test",
      }),
    ).resolves.toEqual({ kind: "DELIVERY_NOT_FOUND" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("creates one idempotent reminder for each pending guest", async () => {
    const reminderAt = new Date("2026-08-13T11:00:00.000Z");
    mocks.prisma.presenceEvent.findMany.mockResolvedValue([
      { id: "event-1", reminderAt, guests: [{ id: "guest-1" }] },
    ]);
    mocks.prisma.presenceDelivery.findUnique.mockResolvedValue({
      ...delivery,
      kind: "REMINDER",
    });

    const result = await processDuePresenceReminders({
      baseUrl: "https://perfect.example.test",
      now: new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(result).toEqual({ events: 1, sent: 1, failed: 0 });
    expect(mocks.prisma.presenceDelivery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: "REMINDER",
          idempotencyKey: `reminder:${reminderAt.toISOString()}:guest-1`,
        }),
      }),
    );
    expect(mocks.prisma.presenceEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reminderProcessedAt: expect.any(Date) } }),
    );
  });
});
