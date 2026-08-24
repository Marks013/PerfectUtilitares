import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePersistentRateLimit,
  jsonError,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  createReajusteModuleSession,
  getReajusteModuleSession,
  REAJUSTE_ACCESS_COOKIE,
  reajusteSessionCookieOptions,
  revokeReajusteModuleSessionCookie,
} from "@/lib/reajuste-salarial/access-session";

const unlockSchema = z
  .object({ password: z.string().min(1).max(72) })
  .strict();
const bcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function configuredStandardPasswordHash() {
  const hash = process.env.REAJUSTE_ACCESS_STANDARD_PASSWORD_HASH?.trim();
  return hash && bcryptHash.test(hash) ? hash : null;
}

export async function GET() {
  const session = await getReajusteModuleSession();
  if (!session) {
    return jsonError(
      401,
      "REAJUSTE_ACCESS_REQUIRED",
      "Digite a senha padrão do módulo para continuar.",
    );
  }
  const response = NextResponse.json({
    access: {
      role: "STANDARD",
      operatorName: session.operatorName,
      expiresAt: session.expiresAt,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await enforcePersistentRateLimit(request, {
    limit: 5,
    windowMs: 15 * 60_000,
    keyPrefix: "reajuste-access-unlock",
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 4 * 1024);
  if (contentLengthError) return contentLengthError;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = unlockSchema.safeParse(body.data);
  if (!parsed.success || Buffer.byteLength(parsed.data.password, "utf8") > 72) {
    return jsonError(
      400,
      "REAJUSTE_PASSWORD_INVALID",
      "Informe uma senha válida.",
    );
  }

  const hash = configuredStandardPasswordHash();
  if (!hash) {
    return jsonError(
      503,
      "REAJUSTE_ACCESS_NOT_CONFIGURED",
      "O acesso ao módulo ainda não foi configurado.",
    );
  }
  if (!(await compare(parsed.data.password, hash))) {
    return jsonError(
      401,
      "REAJUSTE_PASSWORD_INCORRECT",
      "Senha incorreta. Use a senha padrão do módulo Reajuste.",
    );
  }

  try {
    const session = await createReajusteModuleSession();
    const response = NextResponse.json({
      access: {
        role: "STANDARD",
        operatorName: session.operatorName,
        expiresAt: session.expiresAt,
      },
    });
    response.cookies.set(
      REAJUSTE_ACCESS_COOKIE,
      session.value,
      reajusteSessionCookieOptions(session.maxAgeSeconds),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return jsonError(
      503,
      "REAJUSTE_ACCESS_UNAVAILABLE",
      "Não foi possível liberar o módulo agora. Tente novamente.",
    );
  }
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const cookieValue = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REAJUSTE_ACCESS_COOKIE}=`))
    ?.slice(REAJUSTE_ACCESS_COOKIE.length + 1);
  await revokeReajusteModuleSessionCookie(cookieValue);

  const response = NextResponse.json({ revoked: true });
  response.cookies.set(
    REAJUSTE_ACCESS_COOKIE,
    "",
    reajusteSessionCookieOptions(0),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
