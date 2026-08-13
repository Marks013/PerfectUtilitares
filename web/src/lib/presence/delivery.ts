import * as Sentry from "@sentry/nextjs";
import {
  sendPresenceInvitationEmail,
  sendPresenceReminderEmail,
} from "@/lib/email/resend";
import { prisma } from "@/lib/prisma";
import {
  derivePresenceInvitationToken,
  derivePresenceShortCode,
  hashPresenceSecret,
} from "@/lib/presence/tokens";

const SENDING_STALE_MS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;

type DeliveryResult = {
  deliveryId: string | null;
  guestId: string;
  status: "SENT" | "FAILED" | "SKIPPED" | "SENDING";
  reason?: "EMAIL_REQUIRED" | "ALREADY_SENT";
};

function shortInvitationUrl(baseUrl: string, code: string) {
  return new URL(`/p/${code}`, baseUrl).toString();
}

function eventDateLabel(startsAt: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(startsAt);
}

function deliveryErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "DELIVERY_FAILED";
  if (!/^RESEND_[A-Z0-9_]+$/.test(error.message)) return "DELIVERY_FAILED";
  return error.message.slice(0, 120);
}

function retryAt(attemptCount: number, now: Date) {
  const delay = Math.min(
    60_000 * 2 ** Math.max(0, attemptCount - 1),
    MAX_RETRY_DELAY_MS,
  );
  return new Date(now.getTime() + delay);
}

async function processPresenceDelivery(
  deliveryId: string,
  baseUrl: string,
  actorUserId: string | null,
  now = new Date(),
): Promise<DeliveryResult> {
  const staleAt = new Date(now.getTime() - SENDING_STALE_MS);
  const claimed = await prisma.presenceDelivery.updateMany({
    where: {
      id: deliveryId,
      OR: [
        { status: "PENDING" },
        {
          status: "FAILED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "SENDING", updatedAt: { lte: staleAt } },
      ],
    },
    data: {
      status: "SENDING",
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastErrorCode: null,
    },
  });

  const delivery = await prisma.presenceDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      eventId: true,
      guestId: true,
      idempotencyKey: true,
      kind: true,
      status: true,
      attemptCount: true,
      guest: {
        select: {
          id: true,
          name: true,
          email: true,
          guestSlug: true,
        },
      },
      event: {
        select: {
          eventSlug: true,
          title: true,
          startsAt: true,
          venueName: true,
          timeZone: true,
        },
      },
    },
  });
  if (!delivery?.guestId || !delivery.guest) {
    if (delivery) {
      await prisma.presenceDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastErrorCode: "GUEST_UNAVAILABLE" },
      });
    }
    return { deliveryId, guestId: delivery?.guestId ?? "", status: "SKIPPED" };
  }
  if (claimed.count === 0) {
    const alreadySent = delivery.status === "SENT" || delivery.status === "DELIVERED";

    return {
      deliveryId,
      guestId: delivery.guestId,
      status: alreadySent ? "SENT" : "SENDING",
      reason: alreadySent ? "ALREADY_SENT" : undefined,
    };
  }

  if (!delivery.guest.email) {
    await prisma.presenceDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastErrorCode: "EMAIL_REQUIRED" },
    });
    return {
      deliveryId,
      guestId: delivery.guestId,
      status: "SKIPPED",
      reason: "EMAIL_REQUIRED",
    };
  }

  const token = derivePresenceInvitationToken(delivery.id);
  const shortCode = derivePresenceShortCode(delivery.id);
  const inviteUrl = shortInvitationUrl(baseUrl, shortCode);

  try {
    await prisma.$transaction([
      prisma.presenceGuest.update({
        where: { id: delivery.guest.id },
        data: {
          tokenHash: hashPresenceSecret(token),
          shortCodeHash: hashPresenceSecret(shortCode),
          tokenRevokedAt: null,
          accessVersion: { increment: 1 },
        },
      }),
      prisma.presenceGuestSession.updateMany({
        where: { guestId: delivery.guest.id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    const sendEmail =
      delivery.kind === "REMINDER"
        ? sendPresenceReminderEmail
        : sendPresenceInvitationEmail;
    const providerMessageId = await sendEmail({
      to: delivery.guest.email,
      name: delivery.guest.name,
      eventTitle: delivery.event.title,
      eventDate: eventDateLabel(
        delivery.event.startsAt,
        delivery.event.timeZone,
      ),
      venueName: delivery.event.venueName,
      inviteUrl,
      idempotencyKey: `presence/${delivery.id}`,
    });

    await prisma.presenceDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        providerMessageId,
        providerStatus: "sent",
        providerEventAt: new Date(),
        sentAt: new Date(),
        nextAttemptAt: null,
        lastErrorCode: null,
      },
    });
    await prisma.presenceActivity.create({
      data: {
        eventId: delivery.eventId,
        guestId: delivery.guest.id,
        actorUserId,
        action:
          delivery.kind === "REMINDER" ? "SEND_REMINDER" : "SEND_INVITATION",
        entityType: "PresenceDelivery",
        entityId: delivery.id,
      },
    });
    return { deliveryId, guestId: delivery.guestId, status: "SENT" };
  } catch (error) {
    const errorCode = deliveryErrorCode(error);
    await prisma.presenceDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        lastErrorCode: errorCode,
        nextAttemptAt: retryAt(delivery.attemptCount, now),
      },
    });
    Sentry.captureMessage("Presence email delivery failed", {
      level: "error",
      tags: {
        presenceDeliveryId: delivery.id,
        presenceEventId: delivery.eventId,
        errorCode,
      },
    });
    return { deliveryId, guestId: delivery.guestId, status: "FAILED" };
  }
}

export async function deliverPresenceInvitations(input: {
  eventId: string;
  tenantId: string;
  actorUserId: string;
  guestIds: string[];
  requestId: string;
  baseUrl: string;
}) {
  const guestIds = [...new Set(input.guestIds)];
  const event = await prisma.presenceEvent.findFirst({
    where: { id: input.eventId, tenantId: input.tenantId },
    select: {
      id: true,
      status: true,
      confirmationDeadline: true,
      guests: {
        where: { id: { in: guestIds } },
        select: { id: true, email: true },
      },
    },
  });
  if (!event) return { kind: "EVENT_NOT_FOUND" as const };
  if (event.status !== "PUBLISHED") {
    return { kind: "EVENT_NOT_PUBLISHED" as const };
  }
  if (event.confirmationDeadline <= new Date()) {
    return { kind: "CONFIRMATION_CLOSED" as const };
  }

  const guestsById = new Map(event.guests.map((guest) => [guest.id, guest]));
  const results: DeliveryResult[] = [];
  const deliveryIds: string[] = [];
  for (const guestId of guestIds) {
    const guest = guestsById.get(guestId);
    if (!guest?.email) {
      results.push({
        deliveryId: null,
        guestId,
        status: "SKIPPED",
        reason: "EMAIL_REQUIRED",
      });
      continue;
    }
    const idempotencyKey = `invite:${input.requestId}:${guestId}`;
    const delivery = await prisma.presenceDelivery.upsert({
      where: {
        eventId_idempotencyKey: { eventId: event.id, idempotencyKey },
      },
      create: { eventId: event.id, guestId, idempotencyKey },
      update: {},
      select: { id: true },
    });
    deliveryIds.push(delivery.id);
  }

  for (let index = 0; index < deliveryIds.length; index += 5) {
    const chunk = deliveryIds.slice(index, index + 5);
    results.push(
      ...(await Promise.all(
        chunk.map((deliveryId) =>
          processPresenceDelivery(deliveryId, input.baseUrl, input.actorUserId),
        ),
      )),
    );
  }
  return { kind: "OK" as const, results };
}

export async function retryPresenceInvitation(input: {
  eventId: string;
  deliveryId: string;
  tenantId: string;
  actorUserId: string;
  baseUrl: string;
}) {
  const delivery = await prisma.presenceDelivery.findFirst({
    where: {
      id: input.deliveryId,
      eventId: input.eventId,
      event: { tenantId: input.tenantId },
    },
    select: { id: true, status: true },
  });
  if (!delivery) return { kind: "DELIVERY_NOT_FOUND" as const };
  if (delivery.status === "SENT" || delivery.status === "DELIVERED") {
    return { kind: "ALREADY_SENT" as const };
  }
  if (delivery.status === "SENDING") return { kind: "DELIVERY_BUSY" as const };

  await prisma.presenceDelivery.update({
    where: { id: delivery.id },
    data: { status: "PENDING", nextAttemptAt: null },
  });
  const result = await processPresenceDelivery(
    delivery.id,
    input.baseUrl,
    input.actorUserId,
  );
  return { kind: "OK" as const, result };
}

export async function processDuePresenceReminders(input: {
  baseUrl: string;
  now?: Date;
  eventLimit?: number;
}) {
  const now = input.now ?? new Date();
  const events = await prisma.presenceEvent.findMany({
    where: {
      status: "PUBLISHED",
      reminderAt: { lte: now },
      reminderProcessedAt: null,
      confirmationDeadline: { gt: now },
    },
    select: {
      id: true,
      reminderAt: true,
      guests: {
        where: { rsvpStatus: "PENDING", email: { not: null } },
        select: { id: true },
        take: 1_000,
      },
    },
    orderBy: { reminderAt: "asc" },
    take: input.eventLimit ?? 10,
  });

  let sent = 0;
  let failed = 0;
  for (const event of events) {
    const reminderKey = event.reminderAt?.toISOString() ?? "unscheduled";
    const deliveryIds: string[] = [];
    for (const guest of event.guests) {
      const idempotencyKey = `reminder:${reminderKey}:${guest.id}`;
      const delivery = await prisma.presenceDelivery.upsert({
        where: {
          eventId_idempotencyKey: { eventId: event.id, idempotencyKey },
        },
        create: {
          eventId: event.id,
          guestId: guest.id,
          idempotencyKey,
          kind: "REMINDER",
        },
        update: {},
        select: { id: true },
      });
      deliveryIds.push(delivery.id);
    }

    for (let index = 0; index < deliveryIds.length; index += 5) {
      const results = await Promise.all(
        deliveryIds
          .slice(index, index + 5)
          .map((id) => processPresenceDelivery(id, input.baseUrl, null, now)),
      );
      sent += results.filter((result) => result.status === "SENT").length;
      failed += results.filter((result) => result.status === "FAILED").length;
    }

    await prisma.presenceEvent.updateMany({
      where: {
        id: event.id,
        reminderAt: event.reminderAt,
        reminderProcessedAt: null,
      },
      data: { reminderProcessedAt: now },
    });
  }

  return { events: events.length, sent, failed };
}

export async function retryDuePresenceDeliveries(input: {
  baseUrl: string;
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const deliveries = await prisma.presenceDelivery.findMany({
    where: { status: "FAILED", nextAttemptAt: { lte: now } },
    select: { id: true },
    orderBy: { nextAttemptAt: "asc" },
    take: input.limit ?? 50,
  });
  const results: DeliveryResult[] = [];
  for (let index = 0; index < deliveries.length; index += 5) {
    results.push(
      ...(await Promise.all(
        deliveries
          .slice(index, index + 5)
          .map(({ id }) => processPresenceDelivery(id, input.baseUrl, null, now)),
      )),
    );
  }
  return {
    processed: results.length,
    sent: results.filter((result) => result.status === "SENT").length,
    failed: results.filter((result) => result.status === "FAILED").length,
  };
}
