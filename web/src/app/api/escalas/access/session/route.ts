import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, readJsonBody, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { createEscalaModuleSession, ESCALA_ACCESS_COOKIE, escalaSessionCookieOptions, getEscalaModuleSession, revokeEscalaModuleSessionCookie } from "@/lib/escalas/module-session";

export const runtime = "nodejs";
const unlock = z.object({ password: z.string().min(1).max(72) }).strict();
const bcryptHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
function operationalHash() {
  // One source of truth: only Unimed's STANDARD password, never its ADMIN credential.
  const hash = process.env.UNIMED_ACCESS_STANDARD_PASSWORD_HASH?.trim();
  return hash && bcryptHash.test(hash) ? hash : null;
}
function access(expiresAt: Date) { return { role: "OPERATIONAL", expiresAt }; }
function privateJson(value: unknown) { return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }); }

export async function GET() {
  try {
    const session = await getEscalaModuleSession();
    return session ? privateJson({ access: access(session.expiresAt) }) : jsonError(401, "ESCALA_ACCESS_REQUIRED", "Informe a senha operacional para liberar Escalas.");
  } catch { return jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "Não foi possível conferir o acesso. Tente novamente sem fechar o planejamento."); }
}
export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (origin) return origin;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-access-unlock", limit: 5, windowMs: 15 * 60_000 });
  if (limited) return limited;
  const content = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 4096);
  if (content) return content;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = unlock.safeParse(body.data);
  if (!parsed.success || Buffer.byteLength(parsed.data.password, "utf8") > 72) return jsonError(400, "ESCALA_PASSWORD_INVALID", "Informe uma senha válida.");
  const hash = operationalHash();
  if (!hash) return jsonError(503, "ESCALA_ACCESS_NOT_CONFIGURED", "O acesso operacional ainda não está disponível. Use o acesso da sua conta ou consulte o administrador.");
  try {
    if (!(await compare(parsed.data.password, hash))) return jsonError(401, "ESCALA_PASSWORD_INCORRECT", "Senha incorreta. Use a senha operacional padrão do Unimed e tente novamente.");
    const session = await createEscalaModuleSession();
    const response = privateJson({ access: access(session.expiresAt) });
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
