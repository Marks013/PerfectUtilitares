import { createHash } from "node:crypto";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { requireEscalaCapability } from "@/lib/escalas/access";
import { createEscalaExportDescriptor } from "@/lib/escalas/export-projection-contract";
import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed } from "@/lib/api/security";
import { resourceCapacityErrorResponse } from "@/lib/api/resource-capacity";
import { assertResourceCapacity } from "@/lib/system/resource-capacity";
import { getEscala } from "@/lib/escalas/service";
import { exportEscalaPdf, exportEscalaXlsx } from "@/lib/escalas/export";
import { isHoursReferenceOnly } from "@/lib/escalas/hours-reference";
import { escalaExportCache, ESCALA_EXPORT_CONTENT_VERSION } from "@/lib/escalas/export-cache";
import { escalaFailure } from "../http";

export const runtime = "nodejs";
const query = z.object({ id: z.string().min(1).max(100), format: z.enum(["pdf", "xlsx"]), mode: z.enum(["rest", "hours", "both"]).default("both"), revision: z.coerce.number().int().min(1).max(2_000_000_000).optional(), separateSectors: z.enum(["true", "false"]).default("false"), projection: z.enum(["BASIC_SCHEDULE", "ADMIN_FULL"]).default("BASIC_SCHEDULE") });

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some(key => !Object.hasOwn(query.shape, key)) || new Set(keys).size !== keys.length) {
    return jsonError(400, "ESCALA_INVALID_EXPORT", "Há filtros não disponíveis nesta exportação ou parâmetros repetidos. Confira o recorte solicitado.");
  }
  const parsed = query.safeParse({ id: params.get("id"), format: params.get("format"),
    mode: params.get("mode") ?? undefined, revision: params.get("revision") ?? undefined,
    separateSectors: params.get("format") === "pdf" ? params.get("separateSectors") ?? undefined : undefined,
    projection: params.get("projection") ?? undefined,
  });
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_EXPORT", "Informe uma escala, versão, visualização e formato válidos.");
  try {
    const owner = createHash("sha256").update(JSON.stringify([guard.actor.tenantId, guard.actor.userId, guard.actor.moduleSessionId, guard.actor.accountSessionId])).digest("hex").slice(0, 24);
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-export:" + owner, limit: 20, windowMs: 60_000 });
    if (limited) return limited;
    const workspace = await getEscala(guard.actor, parsed.data.id, parsed.data.revision);
    await requireEscalaCapability(guard.actor, `export.schedule.${parsed.data.format}`, workspace.input.branchCode);
    if (parsed.data.projection === "ADMIN_FULL") {
      await requireEscalaCapability(guard.actor, "report.analytics");
    }
    if (isHoursReferenceOnly(workspace.input) && parsed.data.mode !== "hours") return jsonError(409, "ESCALA_HOURS_REFERENCES_ONLY", "Este planejamento contém somente referências de horários. Selecione o relatório de jornadas ou gere também as folgas antes de exportar uma escala completa.");
    if (isHoursReferenceOnly(workspace.input) && !workspace.validation.valid) return jsonError(409, "ESCALA_HOURS_REFERENCE_INVALID", "Confira os horários indicados antes de exportar as referências.");
    if (workspace.input.needsRegeneration || workspace.input.policy.maxConsecutiveWorkDays > 5) return jsonError(409, "ESCALA_SCENARIO_OUTDATED", "Gere e aplique uma nova proposta, depois salve a revisão para exportar o cenário atualizado.");
    const pdf = parsed.data.format === "pdf";
    const separateSectors = false;
    // Authorization and stale-scenario checks deliberately precede all cache access.
    const descriptor = createEscalaExportDescriptor({ contentVersion: ESCALA_EXPORT_CONTENT_VERSION, tenantId: guard.actor.tenantId,
      workspaceId: workspace.id, branchCode: workspace.input.branchCode, revision: workspace.revision, mode: parsed.data.mode,
      format: parsed.data.format, projection: parsed.data.projection, separateSectors });
    if (!descriptor) return jsonError(400, "ESCALA_INVALID_EXPORT", "Projeção inválida.");
    const key = JSON.stringify([descriptor.cacheKey, owner]);
    const content = await escalaExportCache.get(key, async () => {
      await assertResourceCapacity({ inputBytes: Buffer.byteLength(JSON.stringify(workspace.input)), multiplier: 4 });
      return pdf ? exportEscalaPdf(workspace, parsed.data.mode, { separateSectors, projection: parsed.data.projection }) : exportEscalaXlsx(workspace, parsed.data.mode);
    });
    await requireEscalaCapability(guard.actor, `export.schedule.${parsed.data.format}`, workspace.input.branchCode);
    if (parsed.data.projection === "ADMIN_FULL") await requireEscalaCapability(guard.actor, "report.analytics");
    return new Response(Buffer.from(content), { headers: {
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="escala-${workspace.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "_")}-${workspace.input.startDate}-v${workspace.revision}.${parsed.data.format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie",
    } });
  } catch (error) {
    const response = resourceCapacityErrorResponse(error) ?? escalaFailure(error);
    if (response.status === 429) response.headers.set("Retry-After", "3");
    return response;
  }
}
export function POST() { return methodNotAllowed(["GET"]); }
