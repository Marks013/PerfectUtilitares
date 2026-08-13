import { NextResponse } from "next/server";
import { enforcePersistentRateLimit } from "@/lib/api/security";
import { createPresenceSessionForGuest } from "@/lib/presence/access";
import {
  getPresenceCookieOptions,
  hashPresenceSecret,
} from "@/lib/presence/tokens";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ code: string }> };

function unavailable(request: Request) {
  const response = NextResponse.redirect(
    new URL("/presenca/convite/indisponivel", request.url),
    307,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request, context: RouteContext) {
  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "presence-short-link",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { code } = await context.params;
  if (!/^p_[A-Za-z0-9_-]{16}$/.test(code)) return unavailable(request);
  const now = new Date();
  const guest = await prisma.presenceGuest.findUnique({
    where: { shortCodeHash: hashPresenceSecret(code) },
    select: {
      id: true,
      guestSlug: true,
      accessVersion: true,
      accessExpiresAt: true,
      tokenRevokedAt: true,
      event: {
        select: { eventSlug: true, status: true },
      },
    },
  });
  if (
    !guest ||
    guest.tokenRevokedAt ||
    (guest.accessExpiresAt && guest.accessExpiresAt <= now) ||
    !["PUBLISHED", "CLOSED"].includes(guest.event.status)
  ) {
    return unavailable(request);
  }

  const session = await createPresenceSessionForGuest(
    guest,
    guest.event.eventSlug,
    guest.guestSlug,
    now,
  );
  const response = NextResponse.redirect(
    new URL(
      `/presenca/${guest.event.eventSlug}/${guest.guestSlug}`,
      request.url,
    ),
    307,
  );
  response.cookies.set(
    session.cookieName,
    session.sessionToken,
    getPresenceCookieOptions(session.expiresAt),
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
