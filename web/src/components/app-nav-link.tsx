"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === "/escalas" ? "/escala" : pathname;
  const active = current === href || current?.startsWith(href + "/");
  return <Link href={href} className="app-nav-link" aria-current={active ? "page" : undefined}>{children}</Link>;
}
