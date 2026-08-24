import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireResourceCapacity } from "@/lib/api/resource-capacity";
import { requireReajusteAccess } from "@/lib/reajuste-salarial/access.server";
import { SalaryAdjustmentError } from "@/lib/reajuste-salarial/errors";
import { parseFpre131Workbook } from "@/lib/reajuste-salarial/fpre131-parser";
import {
  MAX_FILE_BYTES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
} from "@/lib/reajuste-salarial/limits";
import { buildSalaryRevisionAnalysis } from "@/lib/reajuste-salarial/salary-revision-rules";
import { validateSalaryRevisionFile } from "@/lib/reajuste-salarial/salary-revision-request";
import {
  prepareXlsxArchive,
  XlsxSecurityError,
} from "@/lib/spreadsheets/xlsx-security";
import { getRequestContentLength } from "@/lib/system/resource-capacity";
import { recordUserUsage } from "@/lib/usage/record";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const moduleAccess = await requireReajusteAccess();
  if (!moduleAccess.ok) return moduleAccess.response;
  const authenticatedSession = await auth();
  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "reajuste-salarial-fpre131-analysis",
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (limited) return limited;
  const contentTypeError = requireContentType(request, ["multipart/form-data"]);
  if (contentTypeError) return contentTypeError;
  const lengthError = requireMaxContentLength(request, MAX_FILE_BYTES + 1024 * 1024);
  if (lengthError) return lengthError;
  const capacityError = await requireResourceCapacity({
    inputBytes: getRequestContentLength(request),
    multiplier: 4,
  });
  if (capacityError) return capacityError;

  let stage = "upload";
  let inputBytes = 0;
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError(
        400,
        "REAJUSTE_WORKBOOK_INVALID",
        "Não foi possível ler o arquivo enviado.",
      );
    }
    const file = validateSalaryRevisionFile(formData.get("file"));
    inputBytes = file.size;
    const uploadedBytes = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(uploadedBytes).digest("hex");
    stage = "security";
    const bytes = prepareXlsxArchive(uploadedBytes, { strict: true });
    stage = "parse";
    const parsed = await parseFpre131Workbook(bytes, file.name);
    const analysis = buildSalaryRevisionAnalysis(parsed, fileHash);
    const payload = { analysis };
    const outputBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    await recordUserUsage({
      userId: authenticatedSession?.user.id,
      module: "PDF",
      operation: "REAJUSTE_SALARIAL_ANALISE",
      inputBytes,
      outputBytes,
    });
    const response = NextResponse.json(payload);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    if (error instanceof SalaryAdjustmentError) {
      return jsonError(
        error.status,
        error.code,
        error.message,
        error.diagnostics.length > 0 ? error.diagnostics : undefined,
      );
    }
    if (error instanceof XlsxSecurityError) {
      return jsonError(
        400,
        "REAJUSTE_WORKBOOK_INVALID",
        `${error.message} Exporte novamente como .xlsx e tente outra vez.`,
      );
    }
    const correlationId = randomUUID();
    Sentry.captureException(error, {
      tags: { component: "salary-revision-analysis", stage },
      extra: { correlationId, inputBytes },
    });
    return jsonError(
      503,
      "REAJUSTE_ANALYSIS_FAILED",
      `Não foi possível analisar o arquivo. Código: ${correlationId}`,
    );
  }
}
