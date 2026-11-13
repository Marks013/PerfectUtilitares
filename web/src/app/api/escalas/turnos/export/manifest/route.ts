import { z } from "zod";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { escalaFailure, escalaJson } from "../../../http";
import { createTurnoExportManifest } from "@/lib/escalas/shift-catalog/export";

export const runtime = "nodejs";
const id = z.string().min(1).max(100);
const bodySchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2026).max(9999),
  selections: z.array(z.object({
    workspaceId: id,
    revision: z.number().int().min(1).max(2_000_000_000),
    employees: z.array(z.object({ employeeId: id, localShiftId: id }).strict()).max(250),
  }).strict()).min(1).max(50),
}).strict();

export async function POST(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 512 * 1024);
  if (contentError) return contentError;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "TURNO_INVALID_MANIFEST", "Informe o mês, os planejamentos e as referências de colaborador válidos.");
  try {
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-turnos-manifest", limit: 12, windowMs: 60_000 });
    if (limited) return limited;
    return escalaJson(await createTurnoExportManifest(guard.actor, parsed.data), 201);
  } catch (error) {
    return escalaFailure(error);
  }
}

export function GET() { return methodNotAllowed(["POST"]); }
export function PATCH() { return methodNotAllowed(["POST"]); }
export function DELETE() { return methodNotAllowed(["POST"]); }
