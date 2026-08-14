import { prisma } from "@/lib/prisma";
import { parsePresenceTheme } from "@/lib/presence/theme";

export async function readPresenceState(
  context: { eventId: string; guestId: string },
  now = new Date(),
) {
  const event = await prisma.presenceEvent.findUnique({
    where: { id: context.eventId },
    select: {
      eventSlug: true,
      title: true,
      description: true,
      startsAt: true,
      venueName: true,
      venueAddress: true,
      confirmationDeadline: true,
      timeZone: true,
      status: true,
      theme: true,
      publicRevision: true,
      guests: {
        where: { id: context.guestId },
        take: 1,
        select: {
          guestSlug: true,
          name: true,
          rsvpStatus: true,
          adultCount: true,
          childCount: true,
          respondedAt: true,
        },
      },
      gifts: {
        where: { active: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          categoryId: true,
          emoji: true,
          title: true,
          description: true,
          externalUrl: true,
          position: true,
          quantity: true,
          reservedManually: true,
          reservations: {
            where: { guestId: context.guestId },
            select: { id: true },
            take: 1,
          },
          _count: { select: { reservations: true } },
          category: {
            select: { id: true, name: true, emoji: true, position: true },
          },
        },
      },
    },
  });

  const guest = event?.guests[0];
  if (!event || !guest) return null;

  return {
    revision: event.publicRevision,
    event: {
      eventSlug: event.eventSlug,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      confirmationDeadline: event.confirmationDeadline,
      timeZone: event.timeZone,
      status: event.status,
      theme: parsePresenceTheme(event.theme),
      confirmationOpen:
        event.status === "PUBLISHED" && event.confirmationDeadline >= now,
    },
    guest,
    gifts: event.gifts.map(({ reservations, _count, reservedManually, ...gift }) => {
      const reservedCount =
        _count.reservations + (reservedManually ? 1 : 0);
      const unlimited = gift.quantity === null;
      return {
        ...gift,
        reservedManually,
        reservedCount,
        availableCount: unlimited
          ? null
          : Math.max(0, (gift.quantity ?? 0) - reservedCount),
        unlimited,
        reserved: !unlimited && reservedCount >= (gift.quantity ?? 0),
        reservedByMe: reservations.length > 0,
      };
    }),
  };
}
