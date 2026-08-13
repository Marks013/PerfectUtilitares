import { NextResponse } from "next/server";
import { verifyResendWebhook } from "@/lib/email/resend";
import {
  jsonError,
  methodNotAllowed,
  requireMaxContentLength,
} from "@/lib/api/security";
import {
  recordPresenceResendEvent,
  isResendEmailEvent,
  type ResendEmailEvent,
} from "@/lib/presence/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const contentLengthError = requireMaxContentLength(
    request,
    MAX_WEBHOOK_BYTES,
  );
  if (contentLengthError) return contentLengthError;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError(415, "CONTENT_TYPE_REQUIRED", "Conteúdo não suportado.");
  }

  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!id || id.length > 200 || !timestamp || !signature) {
    return jsonError(400, "INVALID_WEBHOOK_HEADERS", "Webhook inválido.");
  }

  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Webhook muito grande.");
  }

  let verifiedEvent: unknown;
  try {
    verifiedEvent = verifyResendWebhook({ payload, id, timestamp, signature });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "RESEND_WEBHOOK_NOT_CONFIGURED"
    ) {
      return jsonError(
        503,
        "WEBHOOK_NOT_CONFIGURED",
        "Recebimento temporariamente indisponível.",
      );
    }
    return jsonError(400, "INVALID_WEBHOOK_SIGNATURE", "Webhook inválido.");
  }

  if (!isResendEmailEvent(verifiedEvent)) {
    return NextResponse.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const event: ResendEmailEvent = verifiedEvent;

  const result = await recordPresenceResendEvent({ webhookId: id, event });
  if (result.kind === "INVALID_EVENT") {
    return jsonError(400, "INVALID_WEBHOOK_EVENT", "Evento inválido.");
  }
  return NextResponse.json(
    { received: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export function PUT() {
  return methodNotAllowed(["POST"]);
}

export function PATCH() {
  return methodNotAllowed(["POST"]);
}

export function DELETE() {
  return methodNotAllowed(["POST"]);
}
