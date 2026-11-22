import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/security";
import { requireEscalaAccountSession } from "./account-precedence.server";
import { escalaActor, EscalaError, type EscalaActor } from "./access";
import { getEscalaScopedModuleSession } from "./operator-session-store";

type EscalaGuard = { ok: true; actor: EscalaActor } | { ok: false; response: NextResponse };

export async function requireEscalaAccess(): Promise<EscalaGuard> {
  try {
    const account = await requireEscalaAccountSession();
    if (account.ok) return { ok: true, actor: escalaActor(account.session) };
    if (account.response.status !== 401) return account;

    const session = await getEscalaScopedModuleSession();
    if (session) return { ok: true, actor: { userId: null, tenantId: session.principal.tenantId, admin: false, moduleSessionId: session.sessionId } };
  } catch (error) {
    if (error instanceof EscalaError) return { ok: false, response: jsonError(error.status, error.code, error.message) };
    return { ok: false, response: jsonError(503, "ESCALA_ACCESS_UNAVAILABLE", "O acesso está temporariamente indisponível. Seu rascunho foi preservado; tente novamente.") };
  }
  return { ok: false, response: jsonError(401, "ESCALA_ACCESS_REQUIRED", "O acesso ao planejamento expirou ou está bloqueado. Entre novamente sem descartar seu rascunho.") };
}
