import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  presenceEventCreateSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(
      403,
      "ADMIN_TENANT_REQUIRED",
      "Vincule o administrador a uma empresa para gerenciar eventos.",
    );
  }

  const events = await prisma.presenceEvent.findMany({
    where: { tenantId },
    select: {
      id: true,
      eventSlug: true,
      title: true,
      startsAt: true,
      confirmationDeadline: true,
      status: true,
      publicRevision: true,
      _count: { select: { guests: true, gifts: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  return NextResponse.json(events, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(
      403,
      "ADMIN_TENANT_REQUIRED",
      "Vincule o administrador a uma empresa para criar eventos.",
    );
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "admin-presence-events-create",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = presenceEventCreateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise os dados do evento.",
      zodPresenceIssues(parsed.error),
    );
  }

  try {
    const event = await prisma.presenceEvent.create({
      data: {
        tenantId,
        createdById: guard.session.user.id,
        eventSlug: parsed.data.eventSlug,
        title: parsed.data.title,
        description: parsed.data.description,
        startsAt: new Date(parsed.data.startsAt),
        confirmationDeadline: new Date(parsed.data.confirmationDeadline),
        venueName: parsed.data.venueName,
        venueAddress: parsed.data.venueAddress,
        timeZone: parsed.data.timeZone,
        status: parsed.data.status,
        theme: parsed.data.theme,
        reminderAt: parsed.data.reminderAt
          ? new Date(parsed.data.reminderAt)
          : null,
        retentionUntil: parsed.data.retentionUntil
          ? new Date(parsed.data.retentionUntil)
          : new Date(Date.parse(parsed.data.startsAt) + DEFAULT_RETENTION_MS),
        activities: {
          create: {
            actorUser: { connect: { id: guard.session.user.id } },
            action: "CREATE",
            entityType: "PresenceEvent",
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
      },
    });

    return NextResponse.json(event, {
      status: 201,
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

export function PATCH() {
  return methodNotAllowed(["GET", "POST"]);
}

export function DELETE() {
  return methodNotAllowed(["GET", "POST"]);
}
