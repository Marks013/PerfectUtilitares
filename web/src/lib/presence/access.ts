import { prisma } from "@/lib/prisma";
import {
  generatePresenceSessionToken,
  getPresenceCookieName,
  hashPresenceSecret,
} from "@/lib/presence/tokens";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function earliestDate(left: Date, right: Date | null) {
  return right && right < left ? right : left;
}

export async function createPresenceSessionForGuest(
  guest: { id: string; accessVersion: number; accessExpiresAt: Date | null },
  eventSlug: string,
  guestSlug: string,
  now = new Date(),
) {
  const sessionToken = generatePresenceSessionToken();
  const sessionHash = hashPresenceSecret(sessionToken);
  const expiresAt = earliestDate(
    new Date(now.getTime() + SESSION_TTL_MS),
    guest.accessExpiresAt,
  );

  await prisma.$transaction(async (tx) => {
    await tx.presenceGuestSession.deleteMany({
      where: {
        guestId: guest.id,
        OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
      },
    });
    await tx.presenceGuestSession.create({
      data: {
        guestId: guest.id,
        sessionHash,
        accessVersion: guest.accessVersion,
        expiresAt,
      },
    });
  });

  return {
    sessionToken,
    expiresAt,
    cookieName: getPresenceCookieName(eventSlug, guestSlug),
  };
}

export async function exchangePresenceAccess(
  input: { eventSlug: string; guestSlug: string; token: string },
  now = new Date(),
) {
  const tokenHash = hashPresenceSecret(input.token);
  const guest = await prisma.presenceGuest.findFirst({
    where: {
      tokenHash,
      guestSlug: input.guestSlug,
      tokenRevokedAt: null,
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
      event: {
        is: {
          eventSlug: input.eventSlug,
          status: { in: ["PUBLISHED", "CLOSED"] },
        },
      },
    },
    select: {
      id: true,
      accessVersion: true,
      accessExpiresAt: true,
    },
  });

  if (!guest) return null;

  return createPresenceSessionForGuest(
    guest,
    input.eventSlug,
    input.guestSlug,
    now,
  );
}
