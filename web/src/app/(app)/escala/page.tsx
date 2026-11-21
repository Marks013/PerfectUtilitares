import { auth } from "@/auth";
import { EscalaAccessBoundary } from "@/components/escalas/operational-access";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";
import { getEscalaScopedModuleSession, escalaScopedClientAccess } from "@/lib/escalas/operator-session-store";
import { getEscalaAccountClientAccess } from "@/lib/escalas/account-access-view.server";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Escalas 5×2" };

export default async function EscalaPage() {
  try {
    const account = await auth();
    if (account) {
      const context = await getEscalaAccountClientAccess(account);
      if (!context) return <section aria-labelledby="escala-account-access-title">
        <h1 id="escala-account-access-title">Acesso a Escalas indisponível para esta conta</h1>
        <p role="alert">É necessário um usuário ativo vinculado a uma empresa e com acesso a Escalas. Confira seu vínculo com o administrador. A entrada por nome não substitui as permissões desta conta.</p>
      </section>;
      return <EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={context}>
        <EscalasWorkspace />
      </EscalaAccessBoundary>;
    }
    const session = await getEscalaScopedModuleSession();
    return <EscalaAccessBoundary initialAccess={session ? "MODULE" : null} initialContext={session ? escalaScopedClientAccess(session) : null} initialExpiresAt={session ? new Date(session.expiresAtMs).toISOString() : undefined}>
      <EscalasWorkspace />
    </EscalaAccessBoundary>;
  } catch {
    return <section aria-labelledby="escala-access-unavailable-title">
      <h1 id="escala-access-unavailable-title">Não foi possível conferir o acesso</h1>
      <p role="alert">O serviço de acesso está indisponível agora. Tente novamente em instantes; nenhuma saída foi solicitada.</p>
      <a href="/escala">Conferir acesso novamente</a>
    </section>;
  }
}
