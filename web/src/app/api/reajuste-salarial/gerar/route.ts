import { randomUUID } from "node:crypto";
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
import {
  parseCompetencyFileName,
  sortAndValidateCompetencies,
} from "@/lib/reajuste-salarial/competency";
import { consolidateSalaryAdvanceFiles } from "@/lib/reajuste-salarial/consolidator";
import {
  SalaryAdjustmentError,
} from "@/lib/reajuste-salarial/errors";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_REQUEST_BYTES,
  MAX_TOTAL_FILE_BYTES,
  MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES,
  MIN_FILES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
} from "@/lib/reajuste-salarial/limits";
import { parsePercentageBasisPoints } from "@/lib/reajuste-salarial/money";
import { tryAcquireReajusteProcessingSlot } from "@/lib/reajuste-salarial/processing-gate";
import { hasDeclaredReajusteContentLength } from "@/lib/reajuste-salarial/request-security";
import { parseSalaryAdvanceWorkbook } from "@/lib/reajuste-salarial/parser";
import { generateSalaryAdvancePdf } from "@/lib/reajuste-salarial/pdf";
import { prepareXlsxArchive, XlsxSecurityError } from "@/lib/spreadsheets/xlsx-security";
import { getRequestContentLength } from "@/lib/system/resource-capacity";
import { recordUserUsage } from "@/lib/usage/record";

export const runtime = "nodejs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}

function validateFiles(values: FormDataEntryValue[]) {
  if (
    values.length < MIN_FILES ||
    values.length > MAX_FILES ||
    values.some((value) => !isUploadedFile(value))
  ) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      `Envie de ${MIN_FILES} a ${MAX_FILES} arquivos .xlsx.`,
    );
  }
  const files = values as File[];
  let totalBytes = 0;
  for (const file of files) {
    const validMime = !file.type || file.type === XLSX_MIME;
    if (!file.name.toLowerCase().endsWith(".xlsx") || !validMime || file.size === 0) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_WORKBOOK_INVALID",
        `${file.name || "Arquivo"} não é um XLSX válido.`,
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_ROW_LIMIT_EXCEEDED",
        `${file.name} ultrapassa o limite de 10 MB.`,
        [],
        413,
      );
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      "O conjunto de arquivos ultrapassa o limite de 20 MB.",
      [],
      413,
    );
  }
  return { files, totalBytes };
}

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
    keyPrefix: "antecipacao-salarial-pdf",
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["multipart/form-data"]);
  if (contentTypeError) return contentTypeError;
  if (!hasDeclaredReajusteContentLength(request)) {
    return jsonError(
      411,
      "CONTENT_LENGTH_REQUIRED",
      "Não foi possível confirmar o tamanho do envio. Selecione o arquivo novamente e tente outra vez.",
    );
  }
  const lengthError = requireMaxContentLength(request, MAX_REQUEST_BYTES);
  if (lengthError) return lengthError;
  const capacityError = await requireResourceCapacity({
    inputBytes: getRequestContentLength(request),
    multiplier: 5,
  });
  if (capacityError) return capacityError;
  const releaseProcessingSlot = tryAcquireReajusteProcessingSlot();
  if (!releaseProcessingSlot) {
    const response = jsonError(
      503,
      "REAJUSTE_BUSY",
      "Há dois relatórios sendo processados agora. Aguarde alguns segundos e tente novamente.",
    );
    response.headers.set("Retry-After", "5");
    return response;
  }

  let fileCount = 0;
  let totalBytes = 0;
  let stage = "upload";
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError(
        400,
        "REAJUSTE_WORKBOOK_INVALID",
        "Não foi possível ler os arquivos enviados.",
      );
    }
    const validated = validateFiles(formData.getAll("files"));
    fileCount = validated.files.length;
    totalBytes = validated.totalBytes;
    const percentageBasisPoints = parsePercentageBasisPoints(
      String(formData.get("percentage") ?? ""),
    );
    const withCompetency = validated.files.map((file) => ({
      file,
      competency: parseCompetencyFileName(file.name),
    }));
    const orderedCompetencies = sortAndValidateCompetencies(
      withCompetency.map((item) => item.competency),
    );
    const fileByKey = new Map(
      withCompetency.map((item) => [item.competency.key, item.file]),
    );

    stage = "parse";
    const parsedFiles = [];
    for (const competency of orderedCompetencies) {
      const file = fileByKey.get(competency.key);
      if (!file) continue;
      const uploadedBytes = Buffer.from(await file.arrayBuffer());
      const bytes = prepareXlsxArchive(uploadedBytes, {
        strict: true,
        maxEntryUncompressedBytes: MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES,
        maxTotalUncompressedBytes: MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES,
      });
      parsedFiles.push(await parseSalaryAdvanceWorkbook(bytes, competency, file.name));
    }

    stage = "consolidate";
    const report = consolidateSalaryAdvanceFiles(
      parsedFiles,
      percentageBasisPoints,
    );
    stage = "render";
    const pdf = await generateSalaryAdvancePdf(report);
    await recordUserUsage({
      userId: authenticatedSession?.user.id,
      module: "PDF",
      operation: "ANTECIPACAO_SALARIAL",
      inputBytes: totalBytes,
      outputBytes: pdf.byteLength,
    });
    const first = orderedCompetencies[0].key;
    const last = orderedCompetencies.at(-1)?.key ?? first;
    const fileName = `antecipacao-salarial-${first}-a-${last}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
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
      tags: { component: "salary-advance", stage },
      extra: { correlationId, fileCount, totalBytes },
    });
    return jsonError(
      503,
      "REAJUSTE_GENERATION_FAILED",
      `Não foi possível gerar o PDF. Código: ${correlationId}`,
    );
  } finally {
    releaseProcessingSlot();
  }
}
