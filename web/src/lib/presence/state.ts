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
          companionLimit: true,
          companionCount: true,
          respondedAt: true,
        },
      },
      gifts: {
        where: { active: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          externalUrl: true,
          position: true,
          reservedByGuestId: true,
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
    gifts: event.gifts.map(({ reservedByGuestId, ...gift }) => ({
      ...gift,
      reserved: Boolean(reservedByGuestId),
      reservedByMe: reservedByGuestId === context.guestId,
    })),
  };
}
