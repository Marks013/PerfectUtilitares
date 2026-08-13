import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireAdmin,
  requireSameOrigin,
} from "@/lib/api/security";
import { getAppUrl } from "@/lib/email/resend";
import { retryPresenceInvitation } from "@/lib/presence/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventId: string; deliveryId: string }>;
};

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
    keyPrefix: "admin-presence-deliveries-retry",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { eventId, deliveryId } = await context.params;
  const result = await retryPresenceInvitation({
    eventId,
    deliveryId,
    tenantId,
    actorUserId: guard.session.user.id,
    baseUrl: getAppUrl(request),
  });
  if (result.kind === "DELIVERY_NOT_FOUND") {
    return jsonError(404, "DELIVERY_NOT_FOUND", "Envio não encontrado.");
  }
  if (result.kind === "ALREADY_SENT") {
    return jsonError(409, "DELIVERY_ALREADY_SENT", "Este convite já foi enviado.");
  }
  if (result.kind === "DELIVERY_BUSY") {
    return jsonError(409, "DELIVERY_BUSY", "Este envio ainda está em andamento.");
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
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
