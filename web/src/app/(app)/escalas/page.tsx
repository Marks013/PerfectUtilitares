import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Escalas 5×2",
};

export default async function EscalasPage() {
  const session = await auth();
  if (session?.user.status !== "ACTIVE") redirect("/login?callbackUrl=%2Fescalas");
  if (!session.user.tenantId) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Escalas 5×2</h1>
        <p role="alert">
          Sua conta precisa estar vinculada a uma empresa para acessar Escalas. Solicite a vinculação ao administrador.
        </p>
      </section>
    );
  }
  return <EscalasWorkspace />;
}
