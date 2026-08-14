import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  releasePresenceGift,
  reservePresenceGift,
  updatePresenceConfirmation,
} from "@/lib/presence/mutations";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    presenceEvent: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    presenceGuest: { findFirst: vi.fn(), update: vi.fn() },
    presenceGift: { findFirst: vi.fn(), update: vi.fn() },
    presenceGiftReservation: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
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
  mocks.tx.$queryRaw.mockResolvedValue([]);
  mocks.tx.presenceGiftReservation.findUnique.mockResolvedValue(null);
  mocks.tx.presenceGiftReservation.count.mockResolvedValue(0);
  mocks.tx.presenceGiftReservation.create.mockResolvedValue({
    id: "reservation-1",
  });
  mocks.tx.presenceGift.update.mockResolvedValue({ id: "gift-1" });
  mocks.tx.presenceActivity.create.mockResolvedValue({ id: "activity-1" });
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
  it("claims capacity on an active gift from the same event", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.findFirst.mockResolvedValue({
      id: "gift-1",
      quantity: 1,
      reservedManually: false,
      reservedByGuestId: null,
    });
    mocks.tx.presenceEvent.update.mockResolvedValue({ publicRevision: 5 });

    await expect(
      reservePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: true, value: { revision: 5 } });

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.presenceGiftReservation.create).toHaveBeenCalledWith({
      data: {
        giftId: "gift-1",
        guestId: "guest-1",
        reservedAt: expect.any(Date),
      },
    });
    expect(mocks.tx.presenceGift.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "gift-1" },
        data: expect.objectContaining({
          reservedByGuestId: "guest-1",
          version: { increment: 1 },
        }),
      }),
    );
  });

  it("returns conflict when the locked gift has no remaining capacity", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.findFirst.mockResolvedValue({
      id: "gift-1",
      quantity: 1,
      reservedManually: false,
      reservedByGuestId: "guest-2",
    });
    mocks.tx.presenceGiftReservation.count.mockResolvedValue(1);

    await expect(
      reservePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.presenceGiftReservation.create).not.toHaveBeenCalled();
    expect(mocks.tx.presenceEvent.update).not.toHaveBeenCalled();
  });

  it("treats releasing a gift not reserved by this guest as an idempotent no-op", async () => {
    mocks.tx.presenceEvent.findUnique.mockResolvedValue({ status: "PUBLISHED" });
    mocks.tx.presenceGift.findFirst.mockResolvedValue({
      id: "gift-1",
      reservedManually: false,
      reservedByGuestId: "guest-2",
      reservedAt: new Date("2026-08-10T00:00:00Z"),
    });
    mocks.tx.presenceGiftReservation.findUnique.mockResolvedValue(null);
    mocks.tx.presenceEvent.findUniqueOrThrow.mockResolvedValue({
      publicRevision: 7,
    });

    await expect(
      releasePresenceGift(context, "gift-1"),
    ).resolves.toEqual({ ok: true, value: { revision: 7 } });

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.presenceGiftReservation.delete).not.toHaveBeenCalled();
    expect(mocks.tx.presenceGift.update).not.toHaveBeenCalled();
    expect(mocks.tx.presenceEvent.update).not.toHaveBeenCalled();
  });
});
