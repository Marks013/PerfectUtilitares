import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth, type AppSession } from "@/auth";
import {
  checkRateLimit,
  checkSharedRateLimit,
  getRateLimitKey,
  SharedRateLimitUnavailableError,
} from "@/lib/api/rate-limit";

type GuardOk = { ok: true; session: AppSession };
type GuardFail = { ok: false; response: NextResponse };
type JsonBodyOk = { ok: true; data: unknown };
type JsonBodyFail = { ok: false; response: NextResponse };
const requestBodyLimits = new WeakMap<Request, number>();

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

export async function readJsonBody(
  request: Request,
): Promise<JsonBodyOk | JsonBodyFail> {
  const maxBytes = requestBodyLimits.get(request) ?? 1024 * 1024;

  try {
    if (!request.body) {
      throw new SyntaxError("Empty body");
    }

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: jsonError(
            413,
            "PAYLOAD_TOO_LARGE",
            `Os dados enviados ultrapassam o limite de ${Math.max(
              1,
              Math.ceil(maxBytes / 1024),
            )}KB.`,
          ),
        };
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return { ok: true, data: JSON.parse(text) };
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

function getConfiguredOrigins() {
  return [process.env.APP_URL, process.env.AUTH_URL, process.env.NEXTAUTH_URL]
    .map((value) => parseOrigin(value ?? null))
    .filter((origin): origin is string => Boolean(origin));
}

function getForwardedOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    new URL(request.url).protocol.replace(":", "");

  if (!host || !["http", "https"].includes(proto)) {
    return null;
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const configuredOrigins = getConfiguredOrigins();
  const forwardedOrigin = getForwardedOrigin(request);
  const origins = new Set<string>([requestUrl.origin]);

  configuredOrigins.forEach((origin) => origins.add(origin));

  if (
    forwardedOrigin &&
    (configuredOrigins.length === 0
      ? process.env.NODE_ENV !== "production"
      : configuredOrigins.includes(forwardedOrigin))
  ) {
    origins.add(forwardedOrigin);
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

  if (session.user.status !== "ACTIVE") {
    const banned = session.user.status === "BANNED";
    return {
      ok: false,
      response: jsonError(
        403,
        banned ? "USER_BANNED" : "USER_BLOCKED",
        banned
          ? "Esta conta foi banida e não pode acessar recursos pessoais. Fale com o administrador se precisar revisar a situação."
          : "Esta conta está bloqueada temporariamente. Fale com o administrador para recuperar o acesso.",
      ),
    };
  }

  return { ok: true, session };
}

export async function getOptionalSession(): Promise<AppSession | null> {
  const session = (await auth()) as AppSession | null;
  return session?.user.status !== "ACTIVE" ? null : session;
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

export function requireContentType(
  request: Request,
  allowed: string[],
): NextResponse | null {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  const valid = allowed.some((item) => mediaType === item.toLowerCase());

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
  requestBodyLimits.set(request, maxBytes);
  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength) {
    return null;
  }

  const contentLength = Number(rawContentLength);

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return jsonError(
      400,
      "INVALID_CONTENT_LENGTH",
      "O tamanho informado da requisição é inválido.",
    );
  }

  if (contentLength > maxBytes) {
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
  const key = getRateLimitKey(options.keyPrefix, request.headers);
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

export async function enforcePersistentRateLimit(
  request: Request,
  options: { limit: number; windowMs: number; keyPrefix: string },
): Promise<NextResponse | null> {
  const key = getRateLimitKey(options.keyPrefix, request.headers);
  try {
    const result = await checkSharedRateLimit(key, options);
    if (!result.limited) return null;

    const response = jsonError(
      429,
      "RATE_LIMITED",
      "Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.",
    );
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000))),
    );
    return response;
  } catch (error) {
    if (!(error instanceof SharedRateLimitUnavailableError)) throw error;
    Sentry.captureException(error, {
      tags: { rateLimitPrefix: options.keyPrefix, sharedRateLimit: true },
    });
    const response = jsonError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "O controle de tentativas está temporariamente indisponível. Tente novamente em instantes.",
    );
    response.headers.set("Retry-After", "30");
    return response;
  }
}

export async function enforceSharedRateLimit(
  request: Request,
  options: {
    limit: number;
    windowMs: number;
    keyPrefix: string;
    dailyLimit?: number;
    authenticated?: boolean;
  },
): Promise<NextResponse | null> {
  const authenticated =
    options.authenticated ?? Boolean(await getOptionalSession());
  if (authenticated) {
    return null;
  }

  const ipKey = getRateLimitKey("ip", request.headers);
  const checks = [
    {
      key: `${options.keyPrefix}:burst:${ipKey}`,
      limit: options.limit,
      windowMs: options.windowMs,
      scope: "burst",
    },
    ...(options.dailyLimit
      ? [
          {
            key: `${options.keyPrefix}:daily:${ipKey}`,
            limit: options.dailyLimit,
            windowMs: 24 * 60 * 60 * 1_000,
            scope: "daily",
          },
        ]
      : []),
  ];

  for (const check of checks) {
    let result: Awaited<
      ReturnType<typeof checkSharedRateLimit>
    >;
    try {
      result = await checkSharedRateLimit(check.key, check);
    } catch (error) {
      if (!(error instanceof SharedRateLimitUnavailableError)) throw error;
      Sentry.captureException(error, {
        tags: { rateLimitScope: check.scope, sharedRateLimit: true },
      });
      const response = jsonError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Estamos reorganizando a fila por alguns instantes. Seus arquivos continuam no seu dispositivo; tente novamente em meio minuto.",
      );
      response.headers.set("Retry-After", "30");
      return response;
    }
    if (!result.limited) continue;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1_000),
    );
    const response = jsonError(
      429,
      "PUBLIC_LIMIT_REACHED",
      check.scope === "daily"
        ? "Você aproveitou toda a franquia pública deste período. Ela se renova automaticamente em até 24 horas. Para continuar agora sem limite de frequência, entre na sua conta ou solicite um convite ao administrador."
        : "Você fez várias operações em sequência e atingiu uma pausa rápida de segurança. Respire um pouquinho e tente novamente em instantes, ou entre na sua conta para continuar sem limite de frequência.",
      {
        action: {
          href: "/login",
          label: "Entrar na conta",
        },
        retryAfterSeconds,
        scope: check.scope,
      },
    );
    response.headers.set("Retry-After", String(retryAfterSeconds));
    response.headers.set("X-RateLimit-Limit", String(check.limit));
    response.headers.set("X-RateLimit-Remaining", "0");
    response.headers.set(
      "X-RateLimit-Reset",
      String(Math.ceil(result.resetAt / 1_000)),
    );
    return response;
  }

  return null;
}
