"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type JornadaNavItem = {
  href: string;
  label: string;
};

export function JornadaNavTabs({ items }: { items: JornadaNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Ferramentas de Jornada"
      className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-2 app-shadow"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          className={`inline-flex flex-1 items-center justify-center rounded-xl px-4 py-3 text-sm font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] ${pathname === item.href ? "bg-[color:var(--app-canvas)] text-white" : "text-[color:var(--app-muted)] hover:bg-[color:var(--app-surface-strong)]"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
