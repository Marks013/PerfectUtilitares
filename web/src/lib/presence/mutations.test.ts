import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  releasePresenceGift,
  reservePresenceGift,
  updatePresenceConfirmation,
} from "@/lib/presence/mutations";

const mocks = vi.hoisted(() => {
  const tx = {
    presenceEvent: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    presenceGuest: { findFirst: vi.fn(), update: vi.fn() },
    presenceGift: { findFirst: vi.fn(), updateMany: vi.fn() },
    presenceActivity: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(
        async (callback: (value: typeof tx) => unknown) => callback(tx),
      ),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

const context = { eventId: "event-1", guestId: "guest-1" };

describe("presence confirmation mutations", () => {
  it("accepts the attendance quantity supplied by the guest without a host limit", async () => {
    mocks.tx.presenceGuest.findFirst.mockResolvedValue({
      event: {
        status: "PUBLISHED",
        confirmationDeadline: new Date("2026-09-01T00:00:00Z"),
      },
    });
    mocks.tx.presenceEvent.update.mockResolvedValue({ publicRevision: 3 });

    await expect(
      updatePresenceConfirmation(
        context,
        { status: "CONFIRMED", adultCount: 6, childCount: 4 },
        new Date("2026-08-20T00:00:00Z"),
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        revision: 3,
        rsvpStatus: "CONFIRMED",
        adultCount: 6,
        childCount: 4,
      },
    });
    expect(mocks.tx.presenceGuest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adultCount: 6,
          childCount: 4,
          companionCount: 9,
          companionLimit: 9,
        }),
      }),
    );
  });

  it("updates confirmation, revision and audit atomically", async () => {
    mocks.tx.presenceGuest.findFirst.mockResolvedValue({
      event: {
        status: "PUBLISHED",
        confirmationDeadline: new Date("2026-09-01T00:00:00Z"),
      },
    });
    mocks.tx.presenceEvent.update.mockResolvedValue({ publicRevision: 4 });

    await expect(
      updatePresenceConfirmation(
        context,
        { status: "CONFIRMED", adultCount: 2, childCount: 1 },
        new Date("2026-08-20T00:00:00Z"),
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        revision: 4,
        rsvpStatus: "CONFIRMED",
        adultCount: 2,
        childCount: 1,
      },
    });
    expect(mocks.tx.presenceGuest.update).toHaveBeenCalledOnce();
    expect(mocks.tx.presenceActivity.create).toHaveBeenCalledOnce();
  });
});

describe("presence gift mutations", () => {
  it("claims only an active unreserved gift from the same event", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.presenceEvent.update.mockResolvedValue({ publicRevision: 5 });

    await expect(
      reservePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: true, value: { revision: 5 } });
    expect(mocks.tx.presenceGift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "gift-1",
          eventId: "event-1",
          active: true,
          reservedManually: false,
          reservedByGuestId: null,
        }),
      }),
    );
  });

  it("returns conflict after losing a concurrent reservation", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.presenceGift.findFirst.mockResolvedValue({
      reservedByGuestId: "guest-2",
    });

    await expect(
      reservePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(mocks.tx.presenceEvent.update).not.toHaveBeenCalled();
  });

  it("does not let another guest release a reservation", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.findFirst.mockResolvedValue({
      reservedByGuestId: "guest-2",
    });

    await expect(
      releasePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(mocks.tx.presenceGift.updateMany).not.toHaveBeenCalled();
  });
});
