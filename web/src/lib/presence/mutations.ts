import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type PresenceMutationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "CLOSED" | "CONFLICT" | "NOT_FOUND";
    };

export async function updatePresenceConfirmation(
  context: { eventId: string; guestId: string },
  input: {
    status: "CONFIRMED" | "DECLINED";
    adultCount: number;
    childCount: number;
  },
  now = new Date(),
): Promise<
  PresenceMutationResult<{
    revision: number;
    rsvpStatus: "CONFIRMED" | "DECLINED";
    adultCount: number;
    childCount: number;
  }>
> {
  return prisma.$transaction(async (tx) => {
    const guest = await tx.presenceGuest.findFirst({
      where: { id: context.guestId, eventId: context.eventId },
      select: {
        event: {
          select: { status: true, confirmationDeadline: true },
        },
      },
    });
    if (!guest) return { ok: false, code: "NOT_FOUND" };
    if (
      guest.event.status !== "PUBLISHED" ||
      guest.event.confirmationDeadline < now
    ) {
      return { ok: false, code: "CLOSED" };
    }
    const adultCount = input.status === "CONFIRMED" ? input.adultCount : 0;
    const childCount = input.status === "CONFIRMED" ? input.childCount : 0;
    const companionCount = Math.max(0, adultCount + childCount - 1);
    await tx.presenceGuest.update({
      where: { id: context.guestId },
      data: {
        rsvpStatus: input.status,
        adultCount,
        childCount,
        companionCount,
        companionLimit: companionCount,
        respondedAt: now,
      },
    });
    const event = await tx.presenceEvent.update({
      where: { id: context.eventId },
      data: { publicRevision: { increment: 1 } },
      select: { publicRevision: true },
    });
    await tx.presenceActivity.create({
      data: {
        eventId: context.eventId,
        guestId: context.guestId,
        action:
          input.status === "CONFIRMED" ? "CONFIRM_ATTENDANCE" : "DECLINE_ATTENDANCE",
        entityType: "PresenceGuest",
        entityId: context.guestId,
        metadata: {
          adultCount,
          childCount,
        },
      },
    });
    return {
      ok: true,
      value: {
        revision: event.publicRevision,
        rsvpStatus: input.status,
        adultCount,
        childCount,
      },
    };
  });
}

export async function reservePresenceGift(
  context: { eventId: string; guestId: string },
  giftId: string,
  now = new Date(),
): Promise<PresenceMutationResult<{ revision: number }>> {
  return prisma.$transaction(async (tx) => {
    const currentEvent = await tx.presenceEvent.findUnique({
      where: { id: context.eventId },
      select: { status: true },
    });
    if (!currentEvent) return { ok: false, code: "NOT_FOUND" };
    if (currentEvent.status !== "PUBLISHED") {
      return { ok: false, code: "CLOSED" };
    }

    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PresenceGift" WHERE "id" = ${giftId} AND "eventId" = ${context.eventId} FOR UPDATE`,
    );

    const gift = await tx.presenceGift.findFirst({
      where: { id: giftId, eventId: context.eventId, active: true },
      select: {
        id: true,
        quantity: true,
        reservedManually: true,
        reservedByGuestId: true,
      },
    });
    if (!gift) return { ok: false, code: "NOT_FOUND" };

    const existing = await tx.presenceGiftReservation.findUnique({
      where: { giftId_guestId: { giftId, guestId: context.guestId } },
      select: { id: true },
    });
    if (existing) {
      const unchangedEvent = await tx.presenceEvent.findUniqueOrThrow({
        where: { id: context.eventId },
        select: { publicRevision: true },
      });
      return { ok: true, value: { revision: unchangedEvent.publicRevision } };
    }

    const reservationCount = await tx.presenceGiftReservation.count({
      where: { giftId },
    });
    const used = reservationCount + (gift.reservedManually ? 1 : 0);
    if (gift.quantity !== null && used >= gift.quantity) {
      return { ok: false, code: "CONFLICT" };
    }

    await tx.presenceGiftReservation.create({
      data: { giftId, guestId: context.guestId, reservedAt: now },
    });

    await tx.presenceGift.update({
      where: { id: gift.id },
      data: {
        ...(gift.reservedByGuestId
          ? {}
          : { reservedByGuestId: context.guestId, reservedAt: now }),
        version: { increment: 1 },
      },
    });

    const updatedEvent = await tx.presenceEvent.update({
      where: { id: context.eventId },
      data: { publicRevision: { increment: 1 } },
      select: { publicRevision: true },
    });
    await tx.presenceActivity.create({
      data: {
        eventId: context.eventId,
        guestId: context.guestId,
        action: "RESERVE_GIFT",
        entityType: "PresenceGift",
        entityId: giftId,
      },
    });
    return { ok: true, value: { revision: updatedEvent.publicRevision } };
  });
}

export async function releasePresenceGift(
  context: { eventId: string; guestId: string },
  giftId: string,
): Promise<PresenceMutationResult<{ revision: number }>> {
  return prisma.$transaction(async (tx) => {
    const eventStatus = await tx.presenceEvent.findUnique({
      where: { id: context.eventId },
      select: { status: true },
    });
    if (!eventStatus) return { ok: false, code: "NOT_FOUND" };
    if (eventStatus.status !== "PUBLISHED") {
      return { ok: false, code: "CLOSED" };
    }

    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PresenceGift" WHERE "id" = ${giftId} AND "eventId" = ${context.eventId} FOR UPDATE`,
    );

    const gift = await tx.presenceGift.findFirst({
      where: { id: giftId, eventId: context.eventId, active: true },
      select: {
        id: true,
        reservedManually: true,
        reservedByGuestId: true,
        reservedAt: true,
      },
    });
    if (!gift) return { ok: false, code: "NOT_FOUND" };

    const reservation = await tx.presenceGiftReservation.findUnique({
      where: { giftId_guestId: { giftId, guestId: context.guestId } },
      select: { id: true },
    });
    if (!reservation) {
      const unchangedEvent = await tx.presenceEvent.findUniqueOrThrow({
        where: { id: context.eventId },
        select: { publicRevision: true },
      });
      return { ok: true, value: { revision: unchangedEvent.publicRevision } };
    }

    await tx.presenceGiftReservation.delete({ where: { id: reservation.id } });

    let replacement: { guestId: string; reservedAt: Date } | null = null;
    if (gift.reservedByGuestId === context.guestId) {
      replacement = await tx.presenceGiftReservation.findFirst({
        where: { giftId },
        orderBy: { reservedAt: "asc" },
        select: { guestId: true, reservedAt: true },
      });
    }

    await tx.presenceGift.update({
      where: { id: gift.id },
      data: {
        ...(gift.reservedByGuestId === context.guestId
          ? {
              reservedByGuestId: replacement?.guestId ?? null,
              reservedAt:
                replacement?.reservedAt ??
                (gift.reservedManually ? gift.reservedAt : null),
            }
          : {}),
        version: { increment: 1 },
      },
    });

    const event = await tx.presenceEvent.update({
      where: { id: context.eventId },
      data: { publicRevision: { increment: 1 } },
      select: { publicRevision: true },
    });
    await tx.presenceActivity.create({
      data: {
        eventId: context.eventId,
        guestId: context.guestId,
        action: "RELEASE_GIFT",
        entityType: "PresenceGift",
        entityId: giftId,
      },
    });
    return { ok: true, value: { revision: event.publicRevision } };
  });
}
