import { z } from "zod";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { administerEscalaApproval, listEscalaApprovals } from "@/lib/escalas/approved-policy-service";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { isDate } from "@/lib/escalas/dates";
import { requireSameOrigin, requireContentType, requireMaxContentLength, readJsonBody, enforcePersistentRateLimit, jsonError, methodNotAllowed } from "@/lib/api/security";
import { escalaFailure, escalaJson } from "../http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const guard = await requireEscalaAccess(); if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = z.strictObject({ branchCode: z.string().trim().min(1).max(160).transform(canonicalBranchCode),
    startDate: z.string().refine(isDate), endDate: z.string().refine(isDate) }).safeParse(Object.fromEntries(params));
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_COMMAND", "Informe filial e período exatos.");
  try { return escalaJson(await listEscalaApprovals(guard.actor, parsed.data.branchCode, parsed.data.startDate, parsed.data.endDate)); }
  catch (error) { return escalaFailure(error); }
}
export async function POST(request: Request) {
  const guard = await requireEscalaAccess(); if (!guard.ok) return guard.response;
  const error = requireSameOrigin(request) ?? requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 4 * 1024 * 1024);
  if (error) return error;
  const body = await readJsonBody(request); if (!body.ok) return body.response;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-policy-admin", limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  try { const result = await administerEscalaApproval(guard.actor, body.data); return escalaJson(result, "revoked" in result ? 200 : 201); }
  catch (failure) { return escalaFailure(failure); }
}
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
