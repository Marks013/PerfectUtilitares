import "@/app/styles/jornada-core.css";
import "@/app/styles/jornada-history.css";
import "@/app/styles/jornada-responsive.css";
import { auth } from "@/auth";
import { JornadaNavTabs } from "@/components/app-jornada-nav";

export default async function JornadaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user.status === "ACTIVE" && session.user.role === "ADMIN";
  const items = [
    { href: "/jornada/validar", label: "Validar" },
    ...(isAdmin ? [
      { href: "/jornada/regras", label: "Regras" },
      { href: "/jornada/codigos", label: "Códigos" },
      { href: "/jornada/historico", label: "Histórico" },
    ] : []),
  ];

  return <><JornadaNavTabs items={items} />{children}</>;
}
