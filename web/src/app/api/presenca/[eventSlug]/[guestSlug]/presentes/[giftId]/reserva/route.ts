import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  releasePresenceGift,
  reservePresenceGift,
} from "@/lib/presence/mutations";
import { presenceGiftRouteSchema } from "@/lib/presence/schema";
import { resolvePresenceSession } from "@/lib/presence/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    eventSlug: string;
    guestSlug: string;
    giftId: string;
  }>;
};

type ResolvedMutation =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      session: { eventId: string; guestId: string };
      giftId: string;
    };

async function resolveMutation(
  request: Request,
  context: RouteContext,
): Promise<ResolvedMutation> {
  const originError = requireSameOrigin(request);
  if (originError) return { ok: false, response: originError };

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "presence-gift",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return { ok: false, response: limited };

  const route = presenceGiftRouteSchema.safeParse(await context.params);
  if (!route.success) {
    return {
      ok: false,
      response: jsonError(404, "GIFT_NOT_FOUND", "Presente não encontrado."),
    };
  }
  const session = await resolvePresenceSession(
    request,
    route.data.eventSlug,
    route.data.guestSlug,
  );
  if (!session) {
    return {
      ok: false,
      response: jsonError(404, "INVITATION_NOT_FOUND", "Convite não encontrado."),
    };
  }
  return {
    ok: true,
    session: { eventId: session.eventId, guestId: session.guestId },
    giftId: route.data.giftId,
  };
}

function resultResponse(
  result: Awaited<ReturnType<typeof reservePresenceGift>>,
) {
  if (!result.ok) {
    if (result.code === "CLOSED") {
      return jsonError(
        409,
        "GIFT_LIST_CLOSED",
        "A lista de presentes não aceita mais alterações.",
      );
    }
    if (result.code === "CONFLICT") {
      return jsonError(
        409,
        "GIFT_ALREADY_RESERVED",
        "Este presente acabou de ser escolhido por outra pessoa.",
      );
    }
    return jsonError(404, "GIFT_NOT_FOUND", "Presente não encontrado.");
  }
  const response = NextResponse.json(result.value);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request, context: RouteContext) {
  const resolved = await resolveMutation(request, context);
  if (!resolved.ok) return resolved.response;
  return resultResponse(
    await reservePresenceGift(resolved.session, resolved.giftId),
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const resolved = await resolveMutation(request, context);
  if (!resolved.ok) return resolved.response;
  return resultResponse(
    await releasePresenceGift(resolved.session, resolved.giftId),
  );
}

export function GET() {
  return methodNotAllowed(["POST", "DELETE"]);
}
