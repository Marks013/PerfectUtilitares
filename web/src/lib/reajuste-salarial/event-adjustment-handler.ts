import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { enforcePersistentRateLimit, jsonError, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { requireResourceCapacity } from "@/lib/api/resource-capacity";
import { getRequestContentLength } from "@/lib/system/resource-capacity";
import { recordUserUsage } from "@/lib/usage/record";
import { XlsxSecurityError } from "@/lib/spreadsheets/xlsx-security";
import { requireReajusteAccess } from "./access.server";
import { SalaryAdjustmentError } from "./errors";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { generateEventAdjustmentPdf } from "./event-adjustment-pdf";
import { parseEventAdjustmentFiles, parseEventAdjustmentSettings, validateEventAdjustmentFiles } from "./event-adjustment-request";
import { MAX_REQUEST_BYTES, RATE_LIMIT, RATE_WINDOW_MS } from "./limits";
import { runWithReajusteProcessingSlot } from "./processing-gate";
import { hasDeclaredReajusteContentLength } from "./request-security";

export async function handleEventAdjustment(request: Request, output: "analysis" | "pdf") {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requireReajusteAccess();
  if (!access.ok) return access.response;
  const session = await auth();
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "reajuste-eventos", limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });
  if (limited) return limited;
  const typeError = requireContentType(request, ["multipart/form-data"]);
  if (typeError) return typeError;
  if (!hasDeclaredReajusteContentLength(request)) return jsonError(411, "CONTENT_LENGTH_REQUIRED", "Não foi possível confirmar o tamanho do envio. Selecione os arquivos novamente.");
  const lengthError = requireMaxContentLength(request, MAX_REQUEST_BYTES);
  if (lengthError) return lengthError;
  const capacityError = await requireResourceCapacity({ inputBytes: getRequestContentLength(request), multiplier: 5 });
  if (capacityError) return capacityError;

  const processing = await runWithReajusteProcessingSlot(async () => {
    let fileCount = 0;
    let totalBytes = 0;
    let stage = "upload";
    try {
      let formData: FormData;
      try { formData = await request.formData(); } catch { return jsonError(400, "REAJUSTE_WORKBOOK_INVALID", "Não foi possível ler os arquivos enviados."); }
      const validated = validateEventAdjustmentFiles(formData.getAll("files"));
      fileCount = validated.files.length;
      totalBytes = validated.totalBytes;
      const settings = parseEventAdjustmentSettings(formData);
      if (output === "pdf" && settings.bonusNewValueCents === null && settings.sundayNewValueCents === null) return jsonError(400, "REAJUSTE_RULE_INVALID", "Informe ao menos um novo valor para gerar o PDF.");
      stage = "parse";
      const parsed = await parseEventAdjustmentFiles(validated);
      stage = "calculate";
      const report = buildEventAdjustmentReport(parsed, settings);
      if (output === "analysis") {
        return NextResponse.json({ report }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (report.issueCount > 0) return jsonError(409, "REAJUSTE_EVENTS_PENDING", "Há pagamentos com quantidade não confirmada. Confira os valores anteriores e as pendências da apuração antes de gerar o PDF.");
      stage = "render";
      const pdf = await generateEventAdjustmentPdf(report);
      await recordUserUsage({ userId: session?.user.id, module: "PDF", operation: "REAJUSTE_EVENTOS_565_901", inputBytes: totalBytes, outputBytes: pdf.byteLength });
      const first = report.competencies[0].key;
      const last = report.competencies.at(-1)?.key ?? first;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Cache-Control": "no-store", "Content-Type": "application/pdf", "Content-Length": String(pdf.byteLength),
          "Content-Disposition": `attachment; filename="reajuste-eventos-${first}-a-${last}.pdf"`, "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof SalaryAdjustmentError) return jsonError(error.status, error.code, error.message, error.diagnostics.length ? error.diagnostics : undefined);
      if (error instanceof XlsxSecurityError) return jsonError(400, "REAJUSTE_WORKBOOK_INVALID", `${error.message} Exporte novamente como .xlsx e tente outra vez.`);
      const correlationId = randomUUID();
      Sentry.captureException(new Error("Event adjustment processing failed"), { tags: { component: "event-adjustment", stage, output }, extra: { correlationId, fileCount, totalBytes, errorType: error instanceof Error ? error.name : "unknown" } });
      return jsonError(503, "REAJUSTE_GENERATION_FAILED", `Não foi possível concluir a apuração. Código: ${correlationId}`);
    }
  });
  if (processing.status === "busy") {
    const response = jsonError(503, "REAJUSTE_BUSY", "Há dois relatórios sendo processados agora. Aguarde alguns segundos e tente novamente.");
    response.headers.set("Retry-After", "5");
    return response;
  }
  if (processing.status === "unavailable") return jsonError(503, "REAJUSTE_CAPACITY_UNAVAILABLE", "Não foi possível reservar capacidade de processamento. Tente novamente em instantes.");
  return processing.value;
}
