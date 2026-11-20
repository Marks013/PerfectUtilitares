import { auth } from "@/auth";
import { EscalaAccessBoundary } from "@/components/escalas/operational-access";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";
import { getEscalaModuleSession } from "@/lib/escalas/module-session";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Escalas 5×2" };

export default async function EscalaPage() {
  const account = await auth();
  const accountAccess = account?.user.status === "ACTIVE" && Boolean(account.user.tenantId);
  if (account && !accountAccess) return <section aria-labelledby="escala-account-access-title">
    <h1 id="escala-account-access-title">Acesso a Escalas indisponível para esta conta</h1>
    <p role="alert">É necessário um usuário ativo vinculado a uma empresa. Confira seu vínculo com o administrador. A senha operacional não substitui as permissões desta conta.</p>
  </section>;
  const session = accountAccess ? null : await getEscalaModuleSession();
  return <EscalaAccessBoundary initialAccess={accountAccess ? "ACCOUNT" : session ? "MODULE" : null} initialExpiresAt={session?.expiresAt.toISOString()}>
    <EscalasWorkspace />
  </EscalaAccessBoundary>;
}
