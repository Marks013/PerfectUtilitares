import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UnimedCalculationWorkspace } from "@/components/unimed/unimed-calculation-workspace";
import { UnimedModuleNav } from "@/components/unimed/unimed-module-nav";
import { canUseUnimed } from "@/lib/unimed/access";
import { getUnimedConfiguration } from "@/lib/unimed/configuration";
import { getUnimedModuleSession } from "@/lib/unimed/module-session";

export const metadata: Metadata = {
  title: "Cálculo Unimed",
  description:
    "Consulta e cálculo de exclusão do plano Unimed com conferência financeira.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UnimedPage() {
  const session = await getUnimedModuleSession();
  if (!session) redirect("/unimed/acesso");
  const configuration = await getUnimedConfiguration(session.tenantId);

  const canManage = canUseUnimed(
    { role: "OPERATOR", accessLevel: session.level },
    "MANAGE_CONFIG",
  );

  return (
    <>
      <UnimedModuleNav showManagement={canManage} accessRole={session.role} />
      <UnimedCalculationWorkspace
        reasons={configuration.reasons.map((reason) => ({
          code: reason.code,
          label: reason.label,
          documentKind: reason.documentKind,
        }))}
      />
    </>
  );
}
