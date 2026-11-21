import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed } from "@/lib/api/security";
import { turnoCatalogOptionsSchema } from "@/lib/escalas/shift-catalog/flow-contracts";
import { listTurnoCatalogOptions } from "@/lib/escalas/shift-catalog/catalog-options";
import { escalaFailure, escalaJson } from "../../http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = turnoCatalogOptionsSchema.safeParse(Object.fromEntries(params));
  if (!parsed.success || new Set(params.keys()).size !== [...params.keys()].length) return jsonError(400, "TURNO_INVALID_OPTIONS", "Confira pessoa, revisão, datas e paginação.");
  try {
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-turnos-options", limit: 90, windowMs: 60_000 });
    if (limited) return limited;
    return escalaJson(await listTurnoCatalogOptions(guard.actor, parsed.data));
  } catch (error) { return escalaFailure(error); }
}
export function POST() { return methodNotAllowed(["GET"]); }
export const PATCH = POST;
export const DELETE = POST;
