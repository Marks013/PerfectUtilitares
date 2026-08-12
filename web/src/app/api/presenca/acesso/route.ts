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
import { exchangePresenceAccess } from "@/lib/presence/access";
import {
  presenceAccessSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { getPresenceCookieOptions } from "@/lib/presence/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "presence-access",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 2 * 1024);
  if (contentLengthError) return contentLengthError;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = presenceAccessSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise o link do convite.",
      zodPresenceIssues(parsed.error),
    );
  }

  const access = await exchangePresenceAccess(parsed.data);
  if (!access) {
    return jsonError(
      404,
      "INVITATION_NOT_FOUND",
      "Este convite não está disponível. Solicite um novo link ao responsável pelo evento.",
    );
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(
    access.cookieName,
    access.sessionToken,
    getPresenceCookieOptions(access.expiresAt),
  );
  return response;
}
