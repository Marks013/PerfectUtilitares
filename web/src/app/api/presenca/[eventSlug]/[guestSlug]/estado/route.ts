import { NextResponse } from "next/server";
import { checkRateLimit, getHashedRateLimitKey } from "@/lib/api/rate-limit";
import { jsonError, methodNotAllowed } from "@/lib/api/security";
import { presencePublicRouteSchema } from "@/lib/presence/schema";
import { resolvePresenceSession } from "@/lib/presence/session";
import { readPresenceState } from "@/lib/presence/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventSlug: string; guestSlug: string }>;
};

function privateHeaders(etag?: string) {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    ...(etag ? { ETag: etag } : {}),
  };
}

export async function GET(request: Request, context: RouteContext) {
  const parsed = presencePublicRouteSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }

  const session = await resolvePresenceSession(
    request,
    parsed.data.eventSlug,
    parsed.data.guestSlug,
  );
  if (!session) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }

  const rateLimit = checkRateLimit(
    getHashedRateLimitKey("presence-state", session.sessionId),
    { limit: 30, windowMs: 60_000 },
  );
  if (rateLimit.limited) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Muitas atualizações em pouco tempo. Aguarde um instante.",
    );
  }

  const confirmationState = session.confirmationOpen ? "open" : "closed";
  const etag = `W/"presence-${session.publicRevision}-${confirmationState}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: privateHeaders(etag) });
  }

  const state = await readPresenceState(session);
  if (!state) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado.");
  }

  const responseConfirmationState = state.event.confirmationOpen
    ? "open"
    : "closed";
  const responseEtag = `W/"presence-${state.revision}-${responseConfirmationState}"`;

  return NextResponse.json(state, { headers: privateHeaders(responseEtag) });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}
