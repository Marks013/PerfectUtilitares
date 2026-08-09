import type { Metadata } from "next";
import { UnimedConfigurationManager } from "@/components/unimed/unimed-configuration-manager";
import { UnimedModuleNav } from "@/components/unimed/unimed-module-nav";
import { UnimedOfflineDevicesManager } from "@/components/unimed/unimed-offline-devices-manager";
import { requireUnimedManagerPage } from "@/components/unimed/manager-page-access";

export const metadata: Metadata = {
  title: "Configurações Unimed",
  description: "Regras, preços, faixas e comunicação do módulo Unimed.",
  robots: { index: false, follow: false },
};

export default async function UnimedConfigurationPage() {
  const session = await requireUnimedManagerPage("MANAGE_CONFIG");
  return (
    <>
      <UnimedModuleNav showManagement accessRole={session.role} />
      <UnimedConfigurationManager />
      <div className="mt-6">
        <UnimedOfflineDevicesManager />
      </div>
    </>
  );
}
