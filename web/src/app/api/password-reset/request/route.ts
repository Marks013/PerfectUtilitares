import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { normalizeEmail } from "@/lib/auth/email";
import { getSecurityStamp } from "@/lib/auth/security-stamp";
import { checkSharedRateLimit, getHashedRateLimitKey } from "@/lib/api/rate-limit";
import { enqueuePasswordRecovery, getRecoveryConfiguration } from "@/lib/auth/password-recovery";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.email().max(254),
});

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "password-reset-request",
    limit: 8,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 4 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = requestSchema.safeParse(json.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const configuration = getRecoveryConfiguration();
  if (!configuration) return jsonError(503, "RECOVERY_UNAVAILABLE",
    "A recuperação por e-mail está indisponível. Solicite ajuda ao administrador.");

  try {
    const email = normalizeEmail(parsed.data.email);
    const accountLimit = await checkSharedRateLimit(getHashedRateLimitKey("password-reset-account", email), {
      limit: 3, windowMs: 15 * 60_000,
    });
    if (accountLimit.limited) {
      const response = jsonError(429, "RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
      response.headers.set("Retry-After", String(Math.max(1, Math.ceil((accountLimit.resetAt - Date.now()) / 1_000))));
      return response;
    }
    // The same lookup and durable enqueue run for known and unknown addresses.
    // Sending email never happens on the HTTP response path.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, securityVersion: true, tenantId: true,
        email: true, name: true, role: true, status: true },
    });
    const eligible = user?.status === "ACTIVE" && user.tenantId;
    await enqueuePasswordRecovery({
      ...configuration,
      userId: eligible ? user.id : null,
      tenantId: eligible ? user.tenantId : null,
      securityVersion: eligible ? user.securityVersion : null,
      resetStamp: eligible ? getSecurityStamp(user) : null,
    });
    return NextResponse.json({ ok: true });
  } catch {
    console.error(JSON.stringify({ event: "password_recovery_request_failed" }));
    return jsonError(503, "RECOVERY_UNAVAILABLE",
      "A recuperação por e-mail está indisponível. Solicite ajuda ao administrador.");
  }
}
