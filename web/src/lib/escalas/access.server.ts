import type { NextResponse } from "next/server";
import { jsonError, requireSession } from "@/lib/api/security";
import { escalaActor, EscalaError, type EscalaActor } from "./access";
import { getEscalaModuleSession } from "./module-session";

type EscalaGuard = { ok: true; actor: EscalaActor } | { ok: false; response: NextResponse };

export async function requireEscalaAccess(): Promise<EscalaGuard> {
  const account = await requireSession();
  if (account.ok) {
    try { return { ok: true, actor: escalaActor(account.session) }; }
    catch (error) {
      if (error instanceof EscalaError) return { ok: false, response: jsonError(error.status, error.code, error.message) };
      throw error;
    }
  }
  if (account.response.status !== 401) return account;
  try {
    const session = await getEscalaModuleSession();
    if (session) return { ok: true, actor: { userId: null, tenantId: session.tenantId, admin: false, moduleSessionId: session.id } };
  } catch {
    return { ok: false, response: jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "O acesso está temporariamente indisponível. Seu rascunho foi preservado; tente novamente.") };
  }
  return { ok: false, response: jsonError(401, "ESCALA_ACCESS_REQUIRED", "O acesso ao planejamento expirou ou está bloqueado. Informe a senha operacional para continuar sem perder seu rascunho.") };
}
