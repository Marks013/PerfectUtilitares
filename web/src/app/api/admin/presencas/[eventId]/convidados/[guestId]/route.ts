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
  presenceGuestUpdateSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventId: string; guestId: string }>;
};

async function ownedGuest(eventId: string, guestId: string, tenantId: string) {
  return prisma.presenceGuest.findFirst({
    where: { id: guestId, eventId, event: { tenantId } },
    select: {
      id: true,
      eventId: true,
      companionLimit: true,
      companionCount: true,
      rsvpStatus: true,
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-guests-update",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = presenceGuestUpdateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Revise os dados do convite.", zodPresenceIssues(parsed.error));
  }

  const { eventId, guestId } = await context.params;
  const current = await ownedGuest(eventId, guestId, tenantId);
  if (!current) {
    return jsonError(404, "GUEST_NOT_FOUND", "Pessoa convidada não encontrada.");
  }

  const companionLimit = parsed.data.companionLimit ?? current.companionLimit;
  const companionCount = parsed.data.companionCount ?? current.companionCount;
  const rsvpStatus = parsed.data.rsvpStatus ?? current.rsvpStatus;
  if (companionCount > companionLimit) {
    return jsonError(400, "COMPANION_LIMIT_EXCEEDED", "A quantidade de acompanhantes excede o limite do convite.");
  }
  if (rsvpStatus === "DECLINED" && companionCount !== 0) {
    return jsonError(400, "DECLINED_WITH_COMPANIONS", "Uma recusa não pode incluir acompanhantes.");
  }

  try {
    const guest = await prisma.presenceGuest.update({
      where: { id: current.id },
      data: {
        ...parsed.data,
        email:
          parsed.data.email === undefined
            ? undefined
            : parsed.data.email
              ? normalizeEmail(parsed.data.email)
              : null,
        accessExpiresAt:
          parsed.data.accessExpiresAt === undefined
            ? undefined
            : parsed.data.accessExpiresAt
              ? new Date(parsed.data.accessExpiresAt)
              : null,
        companionCount: rsvpStatus === "DECLINED" ? 0 : parsed.data.companionCount,
        respondedAt: parsed.data.rsvpStatus ? new Date() : undefined,
        activities: {
          create: {
            eventId,
            actorUserId: guard.session.user.id,
            action: "UPDATE",
            entityType: "PresenceGuest",
            entityId: current.id,
          },
        },
      },
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
      },
    });
    return NextResponse.json(guest, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError(409, "GUEST_EXISTS", "Já existe uma pessoa com este endereço ou e-mail neste evento.");
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  }
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-guests-delete",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { eventId, guestId } = await context.params;
  const guest = await ownedGuest(eventId, guestId, tenantId);
  if (!guest) {
    return jsonError(404, "GUEST_NOT_FOUND", "Pessoa convidada não encontrada.");
  }

  await prisma.presenceGuest.delete({ where: { id: guest.id } });
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export function GET() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}

export function POST() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}
