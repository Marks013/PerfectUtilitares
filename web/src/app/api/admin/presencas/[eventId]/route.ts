import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  presenceEventUpdateSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ eventId: string }> };
type EventStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

const statusTransitions: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["PUBLISHED", "CLOSED", "ARCHIVED"],
  CLOSED: ["CLOSED", "PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED", "DRAFT"],
};

function tenantRequired() {
  return jsonError(
    403,
    "ADMIN_TENANT_REQUIRED",
    "Vincule o administrador a uma empresa para gerenciar eventos.",
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return tenantRequired();

  const { eventId } = await context.params;
  const event = await prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: {
      id: true,
      eventSlug: true,
      title: true,
      description: true,
      startsAt: true,
      confirmationDeadline: true,
      venueName: true,
      venueAddress: true,
      timeZone: true,
      status: true,
      publicRevision: true,
      createdAt: true,
      updatedAt: true,
      guests: {
        select: {
          id: true,
          name: true,
          email: true,
          guestSlug: true,
          rsvpStatus: true,
          companionLimit: true,
          companionCount: true,
          accessExpiresAt: true,
          tokenRevokedAt: true,
          respondedAt: true,
          createdAt: true,
          _count: { select: { reservedGifts: true } },
        },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        take: 1_000,
      },
      gifts: {
        select: {
          id: true,
          title: true,
          description: true,
          externalUrl: true,
          position: true,
          active: true,
          reservedAt: true,
          reservedByGuest: { select: { id: true, name: true } },
        },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 1_000,
      },
      _count: { select: { guests: true, gifts: true, deliveries: true } },
    },
  });

  if (!event) {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }

  return NextResponse.json(event, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return tenantRequired();

  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-events-update",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = presenceEventUpdateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise os dados do evento.",
      zodPresenceIssues(parsed.error),
    );
  }

  const { eventId } = await context.params;
  const current = await prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: {
      id: true,
      startsAt: true,
      confirmationDeadline: true,
      status: true,
    },
  });
  if (!current) {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }

  const startsAt = parsed.data.startsAt
    ? new Date(parsed.data.startsAt)
    : current.startsAt;
  const confirmationDeadline = parsed.data.confirmationDeadline
    ? new Date(parsed.data.confirmationDeadline)
    : current.confirmationDeadline;
  if (confirmationDeadline.getTime() > startsAt.getTime()) {
    return jsonError(
      400,
      "INVALID_CONFIRMATION_DEADLINE",
      "O prazo de confirmação deve terminar antes do evento.",
    );
  }

  const nextStatus = parsed.data.status ?? current.status;
  if (!statusTransitions[current.status].includes(nextStatus)) {
    return jsonError(
      409,
      "INVALID_STATUS_TRANSITION",
      "A alteração de situação solicitada não é permitida.",
    );
  }

  try {
    const event = await prisma.presenceEvent.update({
      where: { id: current.id },
      data: {
        ...parsed.data,
        startsAt: parsed.data.startsAt ? startsAt : undefined,
        confirmationDeadline: parsed.data.confirmationDeadline
          ? confirmationDeadline
          : undefined,
        publicRevision: { increment: 1 },
        activities: {
          create: {
            actorUserId: guard.session.user.id,
            action: "UPDATE",
            entityType: "PresenceEvent",
            entityId: current.id,
            metadata: { status: nextStatus },
          },
        },
      },
      select: {
        id: true,
        eventSlug: true,
        title: true,
        startsAt: true,
        confirmationDeadline: true,
        status: true,
        publicRevision: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(event, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        409,
        "EVENT_SLUG_EXISTS",
        "Este endereço de evento já está em uso. Escolha outro.",
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return tenantRequired();

  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-events-delete",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { eventId } = await context.params;
  const event = await prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: { id: true, status: true },
  });
  if (!event) {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }
  if (event.status !== "DRAFT" && event.status !== "ARCHIVED") {
    return jsonError(
      409,
      "EVENT_DELETE_REQUIRES_ARCHIVE",
      "Encerre e arquive o evento antes de excluí-lo definitivamente.",
    );
  }

  await prisma.presenceEvent.delete({ where: { id: event.id } });
  return NextResponse.json(
    { deleted: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export function POST() {
  return methodNotAllowed(["GET", "PATCH", "DELETE"]);
}
