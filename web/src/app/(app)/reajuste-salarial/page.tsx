import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReajusteSalarialWorkspace } from "@/components/reajuste-salarial/reajuste-salarial-workspace";
import { getReajusteModuleSession } from "@/lib/reajuste-salarial/access-session";

export const metadata: Metadata = {
  title: "Antecipação e reajuste salarial",
  description: "Antecipação por competências e reajuste salarial com regras especiais em PDF.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReajusteSalarialPage() {
  if (!(await getReajusteModuleSession())) {
    redirect("/reajuste-salarial/acesso");
  }
  return <ReajusteSalarialWorkspace />;
}
