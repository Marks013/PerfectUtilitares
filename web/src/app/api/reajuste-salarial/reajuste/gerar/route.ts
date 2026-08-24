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
import { parsePercentageBasisPoints } from "@/lib/reajuste-salarial/money";
import { generateSalaryRevisionPdf } from "@/lib/reajuste-salarial/salary-revision-pdf";
import { applySalaryRevisionRules } from "@/lib/reajuste-salarial/salary-revision-rules";
import {
  MAX_RULES_JSON_BYTES,
  parseSalaryRevisionRules,
  validateSalaryRevisionFile,
} from "@/lib/reajuste-salarial/salary-revision-request";
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

function requireMatchingHash(value: FormDataEntryValue | null, bytes: Buffer) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_RULE_INVALID",
      "Analise novamente o arquivo antes de gerar o PDF.",
    );
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual.toLowerCase() !== value.toLowerCase()) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      "O arquivo foi alterado após a análise. Analise-o novamente.",
    );
  }
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const moduleAccess = await requireReajusteAccess();
  if (!moduleAccess.ok) return moduleAccess.response;
  const authenticatedSession = await auth();
  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "reajuste-salarial-fpre131-pdf",
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (limited) return limited;
  const contentTypeError = requireContentType(request, ["multipart/form-data"]);
  if (contentTypeError) return contentTypeError;
  const requestLimit = MAX_FILE_BYTES + MAX_RULES_JSON_BYTES + 1024 * 1024;
  const lengthError = requireMaxContentLength(request, requestLimit);
  if (lengthError) return lengthError;
  const capacityError = await requireResourceCapacity({
    inputBytes: getRequestContentLength(request),
    multiplier: 5,
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
        "Não foi possível ler o arquivo e as regras enviados.",
      );
    }
    const file = validateSalaryRevisionFile(formData.get("file"));
    inputBytes = file.size;
    const uploadedBytes = Buffer.from(await file.arrayBuffer());
    requireMatchingHash(formData.get("fileHash"), uploadedBytes);
    const percentageBasisPoints = parsePercentageBasisPoints(
      String(formData.get("percentage") ?? ""),
    );
    const rules = parseSalaryRevisionRules(formData.get("rules"));
    stage = "security";
    const bytes = prepareXlsxArchive(uploadedBytes, { strict: true });
    stage = "parse";
    const parsed = await parseFpre131Workbook(bytes, file.name);
    stage = "calculate";
    const report = applySalaryRevisionRules(
      parsed,
      percentageBasisPoints,
      rules,
    );
    stage = "render";
    const pdf = await generateSalaryRevisionPdf(report);
    await recordUserUsage({
      userId: authenticatedSession?.user.id,
      module: "PDF",
      operation: "REAJUSTE_SALARIAL",
      inputBytes,
      outputBytes: pdf.byteLength,
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="reajuste-salarial.pdf"',
        "Content-Length": String(pdf.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
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
      tags: { component: "salary-revision-pdf", stage },
      extra: { correlationId, inputBytes },
    });
    return jsonError(
      503,
      "REAJUSTE_GENERATION_FAILED",
      `Não foi possível gerar o PDF. Código: ${correlationId}`,
    );
  }
}
