import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logoutAction } from "@/app/login/actions";
import { ThemeToggle } from "@/components/theme-toggle";

const jornadaNavItems = [
  { href: "/jornada/validar", label: "Validar" },
  { href: "/jornada/regras", label: "Regras" },
  { href: "/jornada/codigos", label: "Códigos" },
  { href: "/jornada/historico", label: "Histórico" },
];

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/conta", label: "Conta" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session || session.user.isActive === false) {
    redirect("/login");
  }

  const canUseAllModules = session.user.role === "ADMIN";
  const navItems = [
    ...baseNavItems,
    ...(canUseAllModules || session.user.canAccessJornada
      ? jornadaNavItems
      : []),
    ...(canUseAllModules || session.user.canAccessFotos
      ? [{ href: "/fotos", label: "Fotos 3x4" }]
      : []),
    ...(session.user.role === "ADMIN"
      ? [{ href: "/admin/usuarios", label: "Usuários" }]
      : []),
  ];

  return (
    <div className="min-h-dvh bg-neutral-100">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <Link href="/dashboard" className="text-base font-semibold text-neutral-950">
            Sistema Web
          </Link>
          <nav className="flex max-w-full items-center gap-1 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
