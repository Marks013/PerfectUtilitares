import { auth } from "@/auth";
import { EscalaAccessBoundary } from "@/components/escalas/operational-access";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";
import { getEscalaModuleSession } from "@/lib/escalas/module-session";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Escalas 5×2" };

export default async function EscalaPage() {
  const account = await auth();
  const accountAccess = account?.user.status === "ACTIVE" && Boolean(account.user.tenantId);
  const session = accountAccess ? null : await getEscalaModuleSession();
  return <EscalaAccessBoundary initialAccess={accountAccess ? "ACCOUNT" : session ? "MODULE" : null} initialExpiresAt={session?.expiresAt.toISOString()}>
    <EscalasWorkspace />
  </EscalaAccessBoundary>;
}
