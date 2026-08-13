"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";

type JornadaNavItem = {
  href: string;
  label: string;
};

export function closeJornadaMenu(
  target: Pick<HTMLElement, "closest">,
) {
  target.closest("details")?.removeAttribute("open");
}

export function JornadaNavMenu({ items }: { items: JornadaNavItem[] }) {
  return (
    <details className="group relative">
      <summary className="app-nav-link flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
        Validador de Jornada
        <ChevronDown
          className="size-3.5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 grid min-w-56 gap-1 rounded-xl border border-white/10 bg-[color:var(--app-shell)] p-2 shadow-[var(--app-shell-shadow)] backdrop-blur-xl">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="app-nav-link whitespace-nowrap"
            onClick={(event) => closeJornadaMenu(event.currentTarget)}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
