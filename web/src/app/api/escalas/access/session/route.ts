import { NextResponse } from "next/server";
import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, readJsonBody, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { requireEscalaAccountSession } from "@/lib/escalas/account-precedence.server";
import { getEscalaAccountClientAccess } from "@/lib/escalas/account-access-view.server";
import { ESCALA_ACCESS_COOKIE, escalaSessionCookieOptions, revokeEscalaModuleSessionCookie } from "@/lib/escalas/module-session";
import { createEscalaScopedModuleSession } from "@/lib/escalas/operator-session-issuer";
import { getEscalaScopedModuleSession, verifyEscalaScopedSessionCookie, escalaScopedClientAccess } from "@/lib/escalas/operator-session-store";

export const runtime = "nodejs";
const unlock = z.object({ username: z.string().min(1).max(256) }).strict();
function access(expiresAt: Date) { return { role: "OPERATIONAL", expiresAt }; }
function privateJson(value: unknown) { return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }); }

export async function GET() {
  try {
    const account = await requireEscalaAccountSession();
    if (account.ok) {
      const context = await getEscalaAccountClientAccess(account.session);
      return context ? privateJson({ access: { role: "ACCOUNT" }, context }) : jsonError(403, "ESCALA_TENANT_REQUIRED", "É necessário um usuário ativo vinculado a uma empresa para acessar Escalas.");
    }
    if (account.response.status !== 401) return account.response;
    const session = await getEscalaScopedModuleSession();
    return session ? privateJson({ access: access(new Date(session.expiresAtMs)), context: escalaScopedClientAccess(session) }) : jsonError(401, "ESCALA_ACCESS_REQUIRED", "Informe seu nome cadastrado para entrar em Escalas.");
  } catch { return jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "Não foi possível conferir o acesso. Tente novamente sem fechar o planejamento."); }
}
export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (origin) return origin;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-access-unlock", limit: 5, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const content = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 4096);
  if (content) return content;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const account = await requireEscalaAccountSession();
    if (account.ok) {
      const context = await getEscalaAccountClientAccess(account.session);
      return context ? privateJson({ access: { role: "ACCOUNT" }, context }) : jsonError(403, "ESCALA_TENANT_REQUIRED", "É necessário um usuário ativo vinculado a uma empresa.");
    }
    if (account.response.status !== 401) return account.response;
    const parsed = unlock.safeParse(body.data);
    if (!parsed.success) return jsonError(400, "ESCALA_INVALID_COMMAND", "Informe somente o nome cadastrado.");
    const session = await createEscalaScopedModuleSession(parsed.data.username);
    if (!session) return jsonError(401, "ESCALA_ACCESS_REQUIRED", "O nome não possui acesso operacional ativo. Consulte o administrador.");
    const resolved = await verifyEscalaScopedSessionCookie(session.value);
    if (!resolved) return jsonError(401, "ESCALA_ACCESS_REQUIRED", "O acesso mudou durante a entrada. Tente novamente.");
    const response = privateJson({ access: access(session.expiresAt), context: escalaScopedClientAccess(resolved) });
    response.cookies.set(ESCALA_ACCESS_COOKIE, session.value, escalaSessionCookieOptions(session.maxAgeSeconds));
    return response;
  } catch { return jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "Não foi possível liberar o acesso agora. Tente novamente; nenhum planejamento foi alterado."); }
}
export async function DELETE(request: Request) {
  const origin = requireSameOrigin(request);
  if (origin) return origin;
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(ESCALA_ACCESS_COOKIE + "="))?.slice(ESCALA_ACCESS_COOKIE.length + 1);
  try {
    await revokeEscalaModuleSessionCookie(value);
    const response = privateJson({ revoked: true });
    response.cookies.set(ESCALA_ACCESS_COOKIE, "", escalaSessionCookieOptions(0));
    return response;
  } catch { return jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "Não foi possível confirmar o bloqueio. Tente novamente antes de sair deste dispositivo."); }
}
export function PATCH() { return methodNotAllowed(["GET", "POST", "DELETE"]); }
