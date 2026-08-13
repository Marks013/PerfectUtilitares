import type { ReactNode } from "react";

export function LegalPage({
  eyebrow,
  title,
  summary,
  updatedAt,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-4xl">
      <header className="border-b border-[color:var(--app-border)] pb-7">
        <p className="app-kicker">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-black text-[color:var(--app-fg)] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--app-muted)]">
          {summary}
        </p>
        <p className="mt-4 text-xs font-semibold text-[color:var(--app-muted)]">
          Última atualização: {updatedAt}
        </p>
      </header>
      <div className="legal-content py-8">{children}</div>
    </article>
  );
}
