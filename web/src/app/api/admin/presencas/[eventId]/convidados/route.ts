import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/auth/email";
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
  presenceGuestCreateSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import {
  generatePresenceInvitationToken,
  generatePresenceShortCode,
  hashPresenceSecret,
} from "@/lib/presence/tokens";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ eventId: string }> };

function invitationBaseUrl(request: Request) {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL;
  return new URL(configured ?? request.url).origin;
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(
      403,
      "ADMIN_TENANT_REQUIRED",
      "Vincule o administrador a uma empresa para convidar pessoas.",
    );
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-guests-create",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = presenceGuestCreateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise os dados da pessoa convidada.",
      zodPresenceIssues(parsed.error),
    );
  }

  const { eventId } = await context.params;
  const event = await prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: { id: true, eventSlug: true, startsAt: true },
  });
  if (!event) {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }

  const invitationToken = generatePresenceInvitationToken();
  const shortCode = generatePresenceShortCode();
  const accessExpiresAt = parsed.data.accessExpiresAt
    ? new Date(parsed.data.accessExpiresAt)
    : new Date(event.startsAt.getTime() + 24 * 60 * 60 * 1_000);

  try {
    const guest = await prisma.presenceGuest.create({
      data: {
        eventId: event.id,
        name: parsed.data.name,
        email: parsed.data.email ? normalizeEmail(parsed.data.email) : null,
        guestSlug: parsed.data.guestSlug,
        accessExpiresAt,
        tokenHash: hashPresenceSecret(invitationToken),
        shortCodeHash: hashPresenceSecret(shortCode),
        activities: {
          create: {
            event: { connect: { id: event.id } },
            actorUser: { connect: { id: guard.session.user.id } },
            action: "CREATE",
            entityType: "PresenceGuest",
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        guestSlug: true,
        accessExpiresAt: true,
      },
    });

    const invitationUrl = new URL(
      `/presenca/${event.eventSlug}/${guest.guestSlug}`,
      invitationBaseUrl(request),
    );
    invitationUrl.hash = invitationToken;
    const shortUrl = new URL(`/p/${shortCode}`, invitationBaseUrl(request));

    return NextResponse.json(
      {
        ...guest,
        invitationUrl: invitationUrl.toString(),
        shortUrl: shortUrl.toString(),
      },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        409,
        "GUEST_EXISTS",
        "Já existe uma pessoa com este endereço ou e-mail neste evento.",
      );
    }
    throw error;
  }
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export function PATCH() {
  return methodNotAllowed(["POST"]);
}

export function DELETE() {
  return methodNotAllowed(["POST"]);
}
