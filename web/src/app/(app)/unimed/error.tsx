"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function UnimedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-[28rem] place-items-center px-4">
      <section className="w-full max-w-lg rounded-(--app-radius-lg) border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-6 text-center shadow-[var(--app-shadow)]">
        <AlertTriangle
          className="mx-auto size-9 text-[color:var(--app-coral)]"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-xl font-black text-[color:var(--app-fg)]">
          Não foi possível abrir o módulo
        </h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
          Recarregue esta área. Se o erro continuar, verifique a conexão e as
          permissões do módulo Unimed.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-5 py-2.5 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Tentar novamente
        </button>
      </section>
    </div>
  );
}
