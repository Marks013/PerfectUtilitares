import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ReajusteSalarialWorkspace } from "@/components/reajuste-salarial/reajuste-salarial-workspace";

export const metadata: Metadata = {
  title: "Reajuste salarial retroativo",
  description: "Consolidação de competências e cálculo de reajuste retroativo em PDF.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReajusteSalarialPage() {
  const session = await auth();
  if (
    session?.user.status !== "ACTIVE" ||
    session.user.role !== "ADMIN" ||
    !session.user.tenantId
  ) {
    redirect("/dashboard");
  }
  return <ReajusteSalarialWorkspace />;
}
