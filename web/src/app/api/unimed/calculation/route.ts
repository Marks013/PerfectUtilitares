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
import { calculationRequestSchema } from "@/lib/unimed/calculation-request";
import { runUnimedCalculation } from "@/lib/unimed/calculation-service";
import { zodIssueDetails } from "@/lib/unimed/schema";

export const runtime = "nodejs";
const MAX_CALCULATION_BODY_BYTES = 16 * 1024;

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("CALCULATE");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-calculation",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(
    request,
    MAX_CALCULATION_BODY_BYTES,
  );
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = calculationRequestSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_CALCULATION_INVALID",
      "Revise os dados informados para o cálculo.",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const result = await runUnimedCalculation(access.tenantId, parsed.data);
    if (!result.ok) {
      return jsonError(result.status, result.error.code, result.error.message);
    }
    const response = NextResponse.json(result.data);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return jsonError(
      500,
      "UNIMED_CALCULATION_FAILED",
      "Não foi possível concluir o cálculo. Tente novamente.",
    );
  }
}
