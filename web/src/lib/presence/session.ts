import { prisma } from "@/lib/prisma";
import {
  getPresenceCookieName,
  hashPresenceSecret,
} from "@/lib/presence/tokens";

const TOUCH_INTERVAL_MS = 15 * 60 * 1_000;

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export async function resolvePresenceSession(
  request: Request,
  eventSlug: string,
  guestSlug: string,
  now = new Date(),
) {
  const cookieName = getPresenceCookieName(eventSlug, guestSlug);
  const sessionToken = readCookie(request, cookieName);
  if (!sessionToken || !/^s_[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;

  const session = await prisma.presenceGuestSession.findUnique({
    where: { sessionHash: hashPresenceSecret(sessionToken) },
    select: {
      id: true,
      accessVersion: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      guest: {
        select: {
          id: true,
          guestSlug: true,
          accessVersion: true,
          accessExpiresAt: true,
          tokenRevokedAt: true,
          event: {
            select: {
              id: true,
              eventSlug: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.accessVersion !== session.guest.accessVersion ||
    session.guest.tokenRevokedAt ||
    (session.guest.accessExpiresAt && session.guest.accessExpiresAt <= now) ||
    session.guest.guestSlug !== guestSlug ||
    session.guest.event.eventSlug !== eventSlug ||
    !["PUBLISHED", "CLOSED"].includes(session.guest.event.status)
  ) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await prisma.presenceGuestSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  return {
    sessionId: session.id,
    guestId: session.guest.id,
    eventId: session.guest.event.id,
    eventStatus: session.guest.event.status,
    expiresAt: session.expiresAt,
  };
}
