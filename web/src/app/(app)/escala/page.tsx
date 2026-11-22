import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { requireEscalaAccountSession } from "@/lib/escalas/account-precedence.server";
import { EscalaAccessBoundary } from "@/components/escalas/operational-access";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";
import { getEscalaScopedModuleSession, escalaScopedClientAccess } from "@/lib/escalas/operator-session-store";
import { getEscalaAccountClientAccess } from "@/lib/escalas/account-access-view.server";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Escalas 5×2" };

function AccountAccessUnavailable() {
  return <section aria-labelledby="escala-account-access-title">
    <h1 id="escala-account-access-title">Acesso a Escalas indisponível para esta conta</h1>
    <p role="alert">Confira se sua conta do site está ativa e vinculada a uma empresa. Você pode entrar novamente na conta ou encerrar a sessão deste dispositivo.</p>
    <p><Link href="/login?callbackUrl=%2Fescala">Entrar na conta do site</Link></p>
    <form action={logoutAction}>
      <button type="submit" className="app-nav-link">Encerrar sessão do site</button>
    </form>
  </section>;
}

export default async function EscalaPage() {
  try {
    const account = await requireEscalaAccountSession();
    if (account.ok) {
      const context = await getEscalaAccountClientAccess(account.session);
      if (!context) return <AccountAccessUnavailable />;
      return <EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={context}>
        <EscalasWorkspace />
      </EscalaAccessBoundary>;
    }
    if (account.response.status !== 401) return <AccountAccessUnavailable />;

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
