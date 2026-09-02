import { NextResponse } from "next/server";
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
import { getAppUrl } from "@/lib/email/resend";
import { deliverPresenceInvitations } from "@/lib/presence/delivery";
import {
  presenceInvitationDeliverySchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(
      403,
      "ADMIN_TENANT_REQUIRED",
      "Vincule o administrador a uma empresa para enviar convites.",
    );
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "admin-presence-deliveries-create",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = presenceInvitationDeliverySchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise a lista de convites.",
      zodPresenceIssues(parsed.error),
    );
  }

  const { eventId } = await context.params;
  const result = await deliverPresenceInvitations({
    eventId,
    tenantId,
    actorUserId: guard.session.user.id,
    guestIds: parsed.data.guestIds,
    requestId: parsed.data.requestId,
    baseUrl: getAppUrl(request),
  });
  if (result.kind === "EVENT_NOT_FOUND") {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }
  if (result.kind === "EVENT_NOT_PUBLISHED") {
    return jsonError(
      409,
      "EVENT_NOT_PUBLISHED",
      "Publique o evento antes de enviar os convites.",
    );
  }
  if (result.kind === "CONFIRMATION_CLOSED") {
    return jsonError(
      409,
      "CONFIRMATION_CLOSED",
      "O prazo de confirmação deste evento já terminou.",
    );
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
