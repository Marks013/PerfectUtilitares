import { prisma } from "@/lib/prisma";

const REVOKED_SESSION_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
const WEBHOOK_EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

export async function cleanupPresenceData(now = new Date()) {
  const revokedBefore = new Date(now.getTime() - REVOKED_SESSION_GRACE_MS);
  const webhookBefore = new Date(
    now.getTime() - WEBHOOK_EVENT_RETENTION_MS,
  );

  const [sessions, webhookEvents, events] = await prisma.$transaction([
    prisma.presenceGuestSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { revokedAt: { not: null, lte: revokedBefore } },
        ],
      },
    }),
    prisma.presenceWebhookEvent.deleteMany({
      where: { createdAt: { lte: webhookBefore } },
    }),
    prisma.presenceEvent.deleteMany({
      where: { status: "ARCHIVED", retentionUntil: { lte: now } },
    }),
  ]);

  return {
    sessions: sessions.count,
    webhookEvents: webhookEvents.count,
    events: events.count,
  };
}
