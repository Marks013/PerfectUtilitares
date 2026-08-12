import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireAdmin,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  generatePresenceInvitationToken,
  hashPresenceSecret,
} from "@/lib/presence/tokens";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventId: string; guestId: string }>;
};

function invitationBaseUrl(request: Request) {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL;
  return new URL(configured ?? request.url).origin;
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  }
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-presence-links-reissue",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { eventId, guestId } = await context.params;
  const guest = await prisma.presenceGuest.findFirst({
    where: { id: guestId, eventId, event: { tenantId } },
    select: { id: true, guestSlug: true, event: { select: { eventSlug: true } } },
  });
  if (!guest) {
    return jsonError(404, "GUEST_NOT_FOUND", "Pessoa convidada não encontrada.");
  }

  const token = generatePresenceInvitationToken();
  await prisma.$transaction([
    prisma.presenceGuest.update({
      where: { id: guest.id },
      data: {
        tokenHash: hashPresenceSecret(token),
        tokenRevokedAt: null,
        accessVersion: { increment: 1 },
        activities: {
          create: {
            eventId,
            actorUserId: guard.session.user.id,
            action: "REISSUE_LINK",
            entityType: "PresenceGuest",
            entityId: guest.id,
          },
        },
      },
    }),
    prisma.presenceGuestSession.updateMany({
      where: { guestId: guest.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  const invitationUrl = new URL(
    `/presenca/${guest.event.eventSlug}/${guest.guestSlug}`,
    invitationBaseUrl(request),
  );
  invitationUrl.hash = token;

  return NextResponse.json(
    { invitationUrl: invitationUrl.toString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
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
