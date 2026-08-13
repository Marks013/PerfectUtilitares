import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const trackedEvents = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
  "email.opened",
  "email.clicked",
]);

export type ResendEmailEvent = {
  type: string;
  created_at: string;
  data: { email_id?: string };
};

export function isResendEmailEvent(value: unknown): value is ResendEmailEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const data = candidate.data;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.created_at === "string" &&
    Boolean(data) &&
    typeof data === "object"
  );
}

function deliveryUpdate(type: string, occurredAt: Date) {
  const data: Prisma.PresenceDeliveryUpdateManyMutationInput = {
    providerStatus: type.replace("email.", ""),
    providerEventAt: occurredAt,
  };

  switch (type) {
    case "email.sent":
      data.status = "SENT";
      data.sentAt = occurredAt;
      break;
    case "email.delivered":
      data.status = "DELIVERED";
      data.deliveredAt = occurredAt;
      break;
    case "email.delivery_delayed":
      data.status = "DELAYED";
      break;
    case "email.failed":
      data.status = "FAILED";
      data.lastErrorCode = "PROVIDER_FAILED";
      break;
    case "email.bounced":
      data.status = "BOUNCED";
      data.bouncedAt = occurredAt;
      data.lastErrorCode = "PROVIDER_BOUNCED";
      break;
    case "email.complained":
      data.status = "COMPLAINED";
      data.complainedAt = occurredAt;
      data.lastErrorCode = "PROVIDER_COMPLAINT";
      break;
    case "email.suppressed":
      data.status = "SUPPRESSED";
      data.lastErrorCode = "PROVIDER_SUPPRESSED";
      break;
    case "email.opened":
      data.openedAt = occurredAt;
      break;
    case "email.clicked":
      data.clickedAt = occurredAt;
      break;
  }
  return data;
}

export async function recordPresenceResendEvent(input: {
  webhookId: string;
  event: ResendEmailEvent;
}) {
  if (!trackedEvents.has(input.event.type)) return { kind: "IGNORED" as const };

  const providerMessageId = input.event.data.email_id;
  const occurredAt = new Date(input.event.created_at);
  if (
    !providerMessageId ||
    providerMessageId.length > 200 ||
    Number.isNaN(occurredAt.getTime())
  ) {
    return { kind: "INVALID_EVENT" as const };
  }

  const delivery = await prisma.presenceDelivery.findFirst({
    where: { providerMessageId },
    select: { id: true },
  });
  if (!delivery) return { kind: "IGNORED" as const };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.presenceWebhookEvent.create({
        data: {
          id: input.webhookId,
          deliveryId: delivery.id,
          providerMessageId,
          type: input.event.type,
          occurredAt,
        },
      });
      await tx.presenceDelivery.updateMany({
        where: {
          id: delivery.id,
          OR: [
            { providerEventAt: null },
            { providerEventAt: { lte: occurredAt } },
          ],
        },
        data: deliveryUpdate(input.event.type, occurredAt),
      });
    });
    return { kind: "RECORDED" as const };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { kind: "DUPLICATE" as const };
    }
    throw error;
  }
}
