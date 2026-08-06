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
  createUnimedModuleSession,
  getUnimedModuleSession,
  revokeUnimedModuleSessionCookie,
  UNIMED_ACCESS_COOKIE,
  unimedSessionCookieOptions,
} from "@/lib/unimed/module-session";

const OPERATOR_NAMES = {
  STANDARD: "Dp Planalto",
  ADMIN: "Administrador",
} as const;

const unlockSchema = z
  .object({
    password: z.string().min(1).max(72),
  })
  .strict();

function configuredPasswordHashes() {
  const standard = process.env.UNIMED_ACCESS_STANDARD_PASSWORD_HASH?.trim();
  const admin = process.env.UNIMED_ACCESS_ADMIN_PASSWORD_HASH?.trim();
  const bcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
  if (
    !standard ||
    !admin ||
    !bcryptHash.test(standard) ||
    !bcryptHash.test(admin)
  ) {
    return null;
  }
  return { standard, admin };
}

export async function GET() {
  const session = await getUnimedModuleSession();
  if (!session) {
    return jsonError(
      401,
      "UNIMED_ACCESS_REQUIRED",
      "Digite a senha do módulo Unimed para continuar.",
    );
  }
  const response = NextResponse.json({
    access: {
      role: session.role,
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
    keyPrefix: "unimed-access-unlock",
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 4 * 1024);
  if (contentLengthError) return contentLengthError;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = unlockSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_ACCESS_IDENTIFICATION_INVALID",
      "Informe a senha do módulo.",
    );
  }
  if (Buffer.byteLength(parsed.data.password, "utf8") > 72) {
    return jsonError(
      400,
      "UNIMED_PASSWORD_INVALID",
      "Informe uma senha válida.",
    );
  }

  const hashes = configuredPasswordHashes();
  if (!hashes) {
    return jsonError(
      503,
      "UNIMED_ACCESS_NOT_CONFIGURED",
      "O acesso ao módulo ainda não foi configurado.",
    );
  }

  const [standardMatches, adminMatches] = await Promise.all([
    compare(parsed.data.password, hashes.standard),
    compare(parsed.data.password, hashes.admin),
  ]);
  const role = adminMatches ? "ADMIN" : standardMatches ? "STANDARD" : null;
  if (!role) {
    return jsonError(
      401,
      "UNIMED_PASSWORD_INCORRECT",
      "Senha incorreta. Confira e tente novamente.",
    );
  }

  const operatorName = OPERATOR_NAMES[role];

  try {
    const session = await createUnimedModuleSession(
      role,
      operatorName,
    );
    const response = NextResponse.json({
      access: {
        role: session.role,
        operatorName: session.operatorName,
        expiresAt: session.expiresAt,
      },
    });
    response.cookies.set(
      UNIMED_ACCESS_COOKIE,
      session.value,
      unimedSessionCookieOptions(session.maxAgeSeconds),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return jsonError(
      503,
      "UNIMED_ACCESS_UNAVAILABLE",
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
    .find((part) => part.startsWith(`${UNIMED_ACCESS_COOKIE}=`))
    ?.slice(UNIMED_ACCESS_COOKIE.length + 1);
  await revokeUnimedModuleSessionCookie(cookieValue);

  const response = NextResponse.json({ revoked: true });
  response.cookies.set(UNIMED_ACCESS_COOKIE, "", unimedSessionCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
