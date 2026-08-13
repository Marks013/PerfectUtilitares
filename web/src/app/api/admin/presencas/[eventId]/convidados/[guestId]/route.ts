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
      adultCount: true,
      childCount: true,
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

  const rsvpStatus = parsed.data.rsvpStatus ?? current.rsvpStatus;
  const resetAttendance = rsvpStatus !== "CONFIRMED";
  const adultCount = resetAttendance ? 0 : current.adultCount;
  const childCount = resetAttendance ? 0 : current.childCount;
  if (rsvpStatus === "CONFIRMED" && adultCount + childCount === 0) {
    return jsonError(
      400,
      "ATTENDANCE_REQUIRED",
      "A quantidade de adultos e crianças deve ser informada pelo convidado.",
    );
  }

  try {
    const [guest] = await prisma.$transaction([
      prisma.presenceGuest.update({
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
          adultCount,
          childCount,
          companionCount: Math.max(0, adultCount + childCount - 1),
          companionLimit: Math.max(0, adultCount + childCount - 1),
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
          adultCount: true,
          childCount: true,
          accessExpiresAt: true,
          tokenRevokedAt: true,
          respondedAt: true,
        },
      }),
      prisma.presenceEvent.update({
        where: { id: eventId },
        data: { publicRevision: { increment: 1 } },
      }),
    ]);
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

  await prisma.$transaction([
    prisma.presenceGuest.delete({ where: { id: guest.id } }),
    prisma.presenceEvent.update({
      where: { id: eventId },
      data: { publicRevision: { increment: 1 } },
    }),
    prisma.presenceActivity.create({
      data: {
        eventId,
        actorUserId: guard.session.user.id,
        action: "DELETE",
        entityType: "PresenceGuest",
        entityId: guest.id,
      },
    }),
  ]);
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export function GET() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}

export function POST() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}
