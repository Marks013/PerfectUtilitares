import { createHash } from "node:crypto";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, requireSameOrigin } from "@/lib/api/security";
import { resourceCapacityErrorResponse } from "@/lib/api/resource-capacity";
import { assertResourceCapacity } from "@/lib/system/resource-capacity";
import { getEscala } from "@/lib/escalas/service";
import { buildOperationalReport, operationalReportContext } from "@/lib/escalas/operational-report";
import { exportOperationalReportPdf } from "@/lib/escalas/operational-report-pdf";
import { validateHoursReferences } from "@/lib/escalas/hours-reference";
import { parseOperationalReportQuery, validateOperationalReportSelection } from "@/lib/escalas/operational-report-contracts";
import { escalaFailure } from "../http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  if (request.headers.has("origin") || request.headers.has("referer") || request.headers.get("sec-fetch-site") === "cross-site") {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
  }
  const parsed = parseOperationalReportQuery(new URL(request.url).searchParams);
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_OPERATIONAL_QUERY", "Confira a revisão, mês, seções, setores e data do PDF operacional.");
  try {
    const owner = createHash("sha256").update(JSON.stringify([guard.actor.tenantId, guard.actor.userId, guard.actor.moduleSessionId])).digest("hex").slice(0, 24);
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-operational-report:" + owner, limit: 10, windowMs: 60_000 });
    if (limited) return limited;
    // Load the current authorized revision, then compare it with the caller's expected revision.
    const workspace = await getEscala(guard.actor, parsed.data.workspaceId);
    const context = operationalReportContext(workspace);
    const issues = validateOperationalReportSelection(parsed.data, context);
    if (issues.length) return jsonError(issues.some(issue => issue.field === "revision") ? 409 : 400, "ESCALA_INVALID_OPERATIONAL_SELECTION", issues.map(issue => issue.message).join(". "));
    if (!context.hasRoster) {
      // Selection already permits only journeys/variants. Monthly preparation is not a clock-validity gate.
      // Ignore only its stale marker; do not clear needsRegeneration or change any persisted validation.
      const references = validateHoursReferences(workspace.input), shifts = new Set(workspace.input.shifts.map(shift => shift.id));
      const missingClock = workspace.input.employees.some(person => person.planningEnabled !== false
        && person.activeFrom <= workspace.input.endDate && (!person.activeUntil || person.activeUntil >= workspace.input.startDate)
        && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"
        && person.shiftIds.some(id => !shifts.has(id)));
      if (missingClock || references.issues.some(issue => issue.severity === "ERROR" && issue.code !== "SCENARIO_OUTDATED")) {
        return jsonError(409, "ESCALA_REPORT_REFERENCES_INVALID", "Confira os horários de referência, entradas, pausas e limites antes de emitir o PDF. Não é necessário gerar folgas.");
      }
    } else if (workspace.input.needsRegeneration || !workspace.validation.valid) return jsonError(409, "ESCALA_REPORT_REVIEW_REQUIRED", "Confira e salve uma grade válida antes de emitir o PDF operacional.");
    await assertResourceCapacity({ inputBytes: Buffer.byteLength(JSON.stringify(workspace.input)), multiplier: 6 });
    const bytes = await exportOperationalReportPdf(buildOperationalReport(workspace, parsed.data));
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="operacional-${workspace.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "_")}-${parsed.data.month}-r${workspace.revision}.pdf"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
  } catch (error) {
    const capacity = resourceCapacityErrorResponse(error);
    if (capacity) return capacity;
    try { return escalaFailure(error); }
    catch { return jsonError(500, "ESCALA_OPERATIONAL_REPORT_FAILED", "Não foi possível emitir o PDF operacional."); }
  }
}
export function POST() { return methodNotAllowed(["GET"]); }
export const HEAD = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
