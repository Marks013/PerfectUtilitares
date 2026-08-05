import type { Metadata } from "next";
import { UnimedImportWorkspace } from "@/components/unimed/unimed-import-workspace";
import { UnimedModuleNav } from "@/components/unimed/unimed-module-nav";
import { requireUnimedManagerPage } from "@/components/unimed/manager-page-access";

export const metadata: Metadata = {
  title: "Importar bases Unimed",
  description: "Importação e publicação segura das bases mensais Unimed.",
  robots: { index: false, follow: false },
};

export default async function UnimedImportPage() {
  const session = await requireUnimedManagerPage("PUBLISH");
  return (
    <>
      <UnimedModuleNav showManagement accessRole={session.role} />
      <UnimedImportWorkspace />
    </>
  );
}
