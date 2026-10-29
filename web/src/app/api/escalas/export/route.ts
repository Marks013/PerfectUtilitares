import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { z } from "zod";
import { jsonError, methodNotAllowed } from "@/lib/api/security";
import { getEscala } from "@/lib/escalas/service";
import { exportEscalaPdf, exportEscalaXlsx } from "@/lib/escalas/export";
import { escalaFailure } from "../http";

export const runtime = "nodejs";
const query = z.object({ id: z.string().min(1).max(100), format: z.enum(["pdf", "xlsx"]), mode: z.enum(["rest", "hours", "both"]).default("both"), revision: z.coerce.number().int().min(1).max(2_000_000_000).optional() });

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = query.safeParse({ id: params.get("id"), format: params.get("format"), ...(params.has("mode") ? { mode: params.get("mode") } : {}), ...(params.has("revision") ? { revision: params.get("revision") } : {}) });
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_EXPORT", "Informe uma escala, versão, visualização e formato válidos.");
  try {
    const workspace = await getEscala(guard.actor, parsed.data.id, parsed.data.revision);
    if (workspace.input.needsRegeneration || workspace.input.policy.maxConsecutiveWorkDays > 5) return jsonError(409, "ESCALA_SCENARIO_OUTDATED", "Gere e aplique uma nova proposta, depois salve a revisão para exportar o cenário atualizado.");
    const pdf = parsed.data.format === "pdf";
    const content = pdf ? await exportEscalaPdf(workspace, parsed.data.mode) : exportEscalaXlsx(workspace, parsed.data.mode);
    return new Response(Buffer.from(content), { headers: {
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="escala-${workspace.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "_")}-${workspace.input.startDate}-v${workspace.revision}.${parsed.data.format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie",
    } });
  } catch (error) { return escalaFailure(error); }
}
export function POST() { return methodNotAllowed(["GET"]); }
