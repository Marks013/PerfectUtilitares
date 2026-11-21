import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { administerEscalaOperators, listEscalaOperators } from "@/lib/escalas/operator-admin-service";
import { requireSameOrigin, requireContentType, requireMaxContentLength, readJsonBody, enforcePersistentRateLimit, methodNotAllowed } from "@/lib/api/security";
import { escalaFailure, escalaJson } from "../../http";
export const runtime = "nodejs";
export async function GET() {
  const guard = await requireEscalaAccess(); if (!guard.ok) return guard.response;
  try { return escalaJson(await listEscalaOperators(guard.actor)); } catch (error) { return escalaFailure(error); }
}
export async function POST(request: Request) {
  const guard = await requireEscalaAccess(); if (!guard.ok) return guard.response;
  const error = requireSameOrigin(request) ?? requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 128 * 1024);
  if (error) return error;
  const body = await readJsonBody(request); if (!body.ok) return body.response;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-access-admin", limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  try { return escalaJson(await administerEscalaOperators(guard.actor, body.data)); } catch (failure) { return escalaFailure(failure); }
}
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
