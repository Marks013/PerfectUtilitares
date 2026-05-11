import { NextResponse } from "next/server";
import { auth, type AppSession } from "@/auth";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

type GuardOk = { ok: true; session: AppSession };
type GuardFail = { ok: false; response: NextResponse };
type JsonBodyOk = { ok: true; data: unknown };
type JsonBodyFail = { ok: false; response: NextResponse };

export type AppModule = "jornada" | "fotos";

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const response = NextResponse.json(
    { error: { code, message, details } },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function methodNotAllowed(allowed: string[]) {
  const response = jsonError(
    405,
    "METHOD_NOT_ALLOWED",
    `Esta ação não aceita esse método. Métodos permitidos: ${allowed.join(", ")}.`,
  );
  response.headers.set("Allow", allowed.join(", "));
  return response;
}

export async function readJsonBody(request: Request): Promise<JsonBodyOk | JsonBodyFail> {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonError(
        400,
        "INVALID_JSON",
        "Não foi possível ler os dados enviados. Envie um JSON válido.",
      ),
    };
  }
}

function parseOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
  const envOrigin = parseOrigin(process.env.AUTH_URL ?? null);
  const origins = new Set<string>([requestUrl.origin]);

  if (forwardedHost) {
    origins.add(`${forwardedProto}://${forwardedHost}`);
  }

  if (envOrigin) {
    origins.add(envOrigin);
  }

  return origins;
}

export function requireSameOrigin(request: Request): NextResponse | null {
  const allowedOrigins = getAllowedOrigins(request);
  const origin = parseOrigin(request.headers.get("origin"));
  const refererOrigin = parseOrigin(request.headers.get("referer"));
  const suppliedOrigin = origin ?? refererOrigin;

  if (!suppliedOrigin) {
    return jsonError(
      403,
      "ORIGIN_REQUIRED",
      "Não foi possível confirmar a origem da requisição. Recarregue a página e tente novamente.",
    );
  }

  if (!allowedOrigins.has(suppliedOrigin)) {
    return jsonError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "A requisição veio de uma origem não permitida. Recarregue o sistema e tente novamente.",
    );
  }

  return null;
}

export async function requireSession(): Promise<GuardOk | GuardFail> {
  const session = (await auth()) as AppSession | null;
  if (!session) {
    return {
      ok: false,
      response: jsonError(
        401,
        "UNAUTHENTICATED",
        "Sua sessão expirou ou você ainda não entrou. Faça login novamente.",
      ),
    };
  }

  if (session.user.isActive === false) {
    return {
      ok: false,
      response: jsonError(
        403,
        "USER_INACTIVE",
        "Seu usuário está inativo. Solicite a reativação a um administrador.",
      ),
    };
  }

  return { ok: true, session };
}

export async function requireAdmin(): Promise<GuardOk | GuardFail> {
  const guard = await requireSession();
  if (!guard.ok) {
    return guard;
  }

  if (guard.session.user.role !== "ADMIN") {
    return {
      ok: false,
      response: jsonError(
        403,
        "FORBIDDEN",
        "Você não tem permissão para realizar esta ação.",
      ),
    };
  }

  return guard;
}

export async function requireModuleAccess(
  module: AppModule,
): Promise<GuardOk | GuardFail> {
  const guard = await requireSession();
  if (!guard.ok) {
    return guard;
  }

  if (guard.session.user.role === "ADMIN") {
    return guard;
  }

  const allowed =
    module === "jornada"
      ? guard.session.user.canAccessJornada
      : guard.session.user.canAccessFotos;

  if (!allowed) {
    return {
      ok: false,
      response: jsonError(
        403,
        "MODULE_FORBIDDEN",
        "Você não tem acesso a este módulo. Solicite liberação a um administrador.",
      ),
    };
  }

  return guard;
}

export function requireContentType(
  request: Request,
  allowed: string[],
): NextResponse | null {
  const contentType = request.headers.get("content-type") ?? "";
  const valid = allowed.some((item) => contentType.includes(item));

  if (!valid) {
    return jsonError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      `Formato da requisição inválido. Envie os dados como: ${allowed.join(", ")}.`,
    );
  }

  return null;
}

export function requireMaxContentLength(
  request: Request,
  maxBytes: number,
): NextResponse | null {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return jsonError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Os dados enviados ultrapassam o limite de ${Math.floor(maxBytes / 1024 / 1024)}MB.`,
    );
  }

  return null;
}

export function enforceRateLimit(
  request: Request,
  options: { limit: number; windowMs: number; keyPrefix: string },
): NextResponse | null {
  const key = `${options.keyPrefix}:${getClientIp(request.headers)}`;
  const result = checkRateLimit(key, options);

  if (result.limited) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.",
    );
  }

  return null;
}
