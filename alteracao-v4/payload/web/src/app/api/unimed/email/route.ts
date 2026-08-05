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
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import {
  sendUnimedExclusionEmail,
  UnimedEmailInProgressError,
} from "@/lib/unimed/email";
import { unimedEmailRequestSchema, zodIssueDetails } from "@/lib/unimed/schema";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("SEND_EMAIL");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-email",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = unimedEmailRequestSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_EMAIL_CONFIRMATION_REQUIRED",
      "Confirme o envio e selecione um beneficiário válido.",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const sent = await sendUnimedExclusionEmail({
      accessLevel: access.accessLevel,
      tenantId: access.tenantId,
      beneficiaryId: parsed.data.beneficiaryId,
      idempotencyKey: parsed.data.idempotencyKey,
      moduleSessionId: access.moduleSessionId,
      operatorName: access.operatorName,
    });
    const response = NextResponse.json({ sent });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof UnimedEmailInProgressError) {
      return jsonError(
        409,
        "UNIMED_EMAIL_IN_PROGRESS",
        "Este envio já está em processamento.",
      );
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "UNIMED_EMAIL_DISABLED") {
      return jsonError(
        422,
        "UNIMED_EMAIL_DISABLED",
        "O envio de e-mail está desabilitado ou não há destinatários configurados no módulo Unimed.",
      );
    }
    if (code === "UNIMED_BENEFICIARY_NOT_FOUND") {
      return jsonError(
        422,
        "UNIMED_BENEFICIARY_NOT_FOUND",
        "O beneficiário não possui CPF válido ou não pertence às duas competências disponíveis.",
      );
    }
    if (code === "SMTP_NOT_CONFIGURED") {
      return jsonError(
        503,
        "SMTP_NOT_CONFIGURED",
        "Configure SMTP_USER, SMTP_PASSWORD e SMTP_FROM_EMAIL no servidor.",
      );
    }
    if (code === "SMTP_AUTH_ERROR") {
      return jsonError(
        503,
        "SMTP_AUTH_ERROR",
        "O Gmail recusou a autenticação. Gere uma nova senha de aplicativo e confira SMTP_USER e SMTP_PASSWORD.",
      );
    }
    if (code === "SMTP_CONNECTION_ERROR") {
      return jsonError(
        503,
        "SMTP_CONNECTION_ERROR",
        "Não foi possível conectar ao servidor SMTP. Confira host, porta 465, TLS e a saída de rede do container.",
      );
    }
    if (code === "SMTP_RECIPIENT_ERROR") {
      return jsonError(
        502,
        "SMTP_RECIPIENT_ERROR",
        "O servidor SMTP recusou um dos destinatários configurados.",
      );
    }
    return jsonError(
      503,
      "UNIMED_EMAIL_FAILED",
      "O servidor SMTP não confirmou o envio. Consulte o registro do container e tente novamente.",
    );
  }
}
