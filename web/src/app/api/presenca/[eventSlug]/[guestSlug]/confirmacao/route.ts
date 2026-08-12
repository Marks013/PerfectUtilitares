import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { updatePresenceConfirmation } from "@/lib/presence/mutations";
import {
  presenceConfirmationSchema,
  presencePublicRouteSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { resolvePresenceSession } from "@/lib/presence/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventSlug: string; guestSlug: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "presence-confirmation",
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 1024);
  if (contentLengthError) return contentLengthError;

  const route = presencePublicRouteSchema.safeParse(await context.params);
  if (!route.success) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }
  const session = await resolvePresenceSession(
    request,
    route.data.eventSlug,
    route.data.guestSlug,
  );
  if (!session) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = presenceConfirmationSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise sua confirmação e a quantidade de acompanhantes.",
      zodPresenceIssues(parsed.error),
    );
  }

  const result = await updatePresenceConfirmation(session, parsed.data);
  if (!result.ok) {
    if (result.code === "CLOSED") {
      return jsonError(
        409,
        "CONFIRMATION_CLOSED",
        "O prazo de confirmação terminou. Fale com o responsável pelo evento para ajustar sua resposta.",
      );
    }
    if (result.code === "COMPANION_LIMIT") {
      return jsonError(
        400,
        "COMPANION_LIMIT",
        "A quantidade de acompanhantes ultrapassa o limite deste convite.",
      );
    }
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }

  const response = NextResponse.json(result.value);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function GET() {
  return methodNotAllowed(["PATCH"]);
}

export function POST() {
  return methodNotAllowed(["PATCH"]);
}
