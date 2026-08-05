import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";

const publicNavItems = [
  { href: "/dashboard", label: "Início" },
  { href: "/jornada/validar", label: "Validar" },
  { href: "/fotos", label: "Fotos 3x4" },
  { href: "/pdf", label: "PDF" },
  { href: "/unimed", label: "Unimed" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const activeSession = session?.user.status !== "ACTIVE" ? null : session;
  const navItems = [
    ...publicNavItems,
    ...(activeSession
      ? [
          { href: "/jornada/historico", label: "Meu histórico" },
          { href: "/conta", label: "Conta" },
        ]
      : []),
    ...(activeSession?.user.role === "ADMIN"
      ? [
          { href: "/jornada/regras", label: "Regras" },
          { href: "/jornada/codigos", label: "Códigos" },
          { href: "/admin/usuarios", label: "Usuários" },
        ]
      : []),
  ];

  const userLabel =
    activeSession?.user.name ??
    activeSession?.user.email ??
    "Acesso público";

  return (
    <div className="app-frame min-h-dvh">
      <div className="app-ambient" aria-hidden="true" />
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-[1.75rem] border border-white/10 bg-[color:var(--app-shell)] px-4 py-3 shadow-[var(--app-shell-shadow)] backdrop-blur-xl sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <Link href="/dashboard" className="group flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--app-coral),var(--app-teal))] text-base font-black text-white shadow-[0_18px_40px_rgba(14,165,157,0.28)] transition-transform duration-300 group-hover:rotate-3 group-hover:scale-105">
              PU
            </span>
            <span className="min-w-0">
              <span className="block text-base font-black tracking-normal text-[color:var(--app-fg)]">
                PerfectUtilitares
              </span>
              <span className="block max-w-[13rem] truncate text-xs font-medium text-[color:var(--app-muted)]">
                {userLabel}
              </span>
            </span>
          </Link>

          <nav className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:justify-center lg:overflow-visible lg:pb-0">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="app-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {activeSession ? (
              <form action={logoutAction}>
                <button className="app-icon-button app-logout-button" title="Sair">
                  <LogOut className="size-4" aria-hidden="true" />
                  <span className="sr-only">Sair</span>
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="app-icon-button"
                title="Entrar"
                aria-label="Entrar"
              >
                <LogIn className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:py-10">
        {children}
      </main>
    </div>
  );
}
