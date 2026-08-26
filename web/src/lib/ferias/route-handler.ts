import * as Sentry from "@sentry/nextjs";
import { requireResourceCapacity } from "@/lib/api/resource-capacity";
import { enforcePersistentRateLimit, jsonError, requireAdmin, requireSameOrigin } from "@/lib/api/security";
import { FeriasError } from "@/lib/ferias/errors";
import { assertFeriasActive, runFeriasWorkbook, withFeriasProcessing } from "@/lib/ferias/processing";
import { FERIAS_MAX_FILE_BYTES, readFeriasRequest } from "@/lib/ferias/request";
import { analyzeFerias } from "@/lib/ferias/service";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function handleFeriasRequest(request: Request, exporting: boolean): Promise<Response> {
  try {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
    const access = await requireAdmin();
    if (!access.ok) return access.response;
    const tenantId = access.session.user.tenantId;
    if (!tenantId) return jsonError(403, "FERIAS_TENANT_REQUIRED", "Sua conta não está vinculada a uma empresa.");
    const limited = await enforcePersistentRateLimit(request, {
      keyPrefix: `ferias:${tenantId}:${access.session.user.id}`,
      limit: 12,
      windowMs: 60_000,
    });
    if (limited) return limited;
    const pressure = await requireResourceCapacity({ inputBytes: FERIAS_MAX_FILE_BYTES, multiplier: 8 });
    if (pressure) return pressure;

    return await withFeriasProcessing(request.signal, async (signal) => {
      const input = await readFeriasRequest(request, signal, exporting);
      const parsed = await runFeriasWorkbook({ action: "parse", buffer: input.buffer }, signal);
      const analysis = await analyzeFerias(tenantId, parsed.rows, parsed.competency, input.choices, input.fileHash);
      assertFeriasActive(signal);
      if (!exporting) return Response.json(analysis, { headers: PRIVATE_HEADERS });
      if (analysis.revision !== input.revision) {
        throw new FeriasError("FERIAS_SOURCE_CHANGED", "As bases ou as escolhas mudaram. Analise novamente antes de baixar.", 409);
      }
      if (!analysis.canExport) {
        throw new FeriasError("FERIAS_PENDING", "Resolva as pendências da análise antes de baixar a planilha.", 422);
      }
      const rows = analysis.rows.map(({ row, highlight, days, unimedText, loanText }) => ({ row, highlight, days, unimedText, loanText }));
      const buffer = await runFeriasWorkbook({ action: "write", buffer: input.buffer, rows }, signal);
      const [year, month] = parsed.competency.split("-");
      return new Response(new Uint8Array(buffer), {
        headers: {
          ...PRIVATE_HEADERS,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="FERIAS-${month}-${year}-CONFERIDO.xlsx"`,
          "Content-Length": String(buffer.byteLength),
        },
      });
    });
  } catch (error) {
    if (error instanceof FeriasError) {
      const response = jsonError(error.status, error.code, error.message);
      response.headers.set("X-Content-Type-Options", "nosniff");
      if (error.status === 503) response.headers.set("Retry-After", "10");
      return response;
    }
    Sentry.captureMessage("Ferias orchestration failed", { level: "error", tags: { module: "ferias", operation: exporting ? "export" : "analyze" } });
    return jsonError(500, "FERIAS_PROCESSING_FAILED", "Não foi possível concluir o processamento agora. Tente novamente em instantes.");
  }
}
