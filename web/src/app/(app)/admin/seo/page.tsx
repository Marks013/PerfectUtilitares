import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SeoMonitoringDashboard } from "@/components/seo-monitoring-dashboard";
import { getSearchConsoleSnapshot } from "@/lib/seo/search-console";
import { getWebVitalsSnapshot } from "@/lib/seo/web-vitals";

export const metadata: Metadata = {
  title: "Visibilidade",
  robots: { index: false, follow: false },
};

export default async function SeoAdminPage() {
  const session = await auth();
  if (session?.user.status !== "ACTIVE" || session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const [search, vitals] = await Promise.all([
    getSearchConsoleSnapshot(),
    getWebVitalsSnapshot(),
  ]);

  return <SeoMonitoringDashboard search={search} vitals={vitals} />;
}
