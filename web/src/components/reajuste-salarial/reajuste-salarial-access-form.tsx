"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function ReajusteSalarialAccessForm({
  nextPath,
}: {
  nextPath: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/reajuste-salarial/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "Não foi possível liberar o módulo.",
        );
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-[2rem] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-card-shadow)] sm:p-8">
      <div className="mb-6 flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[color:var(--app-teal-soft)] text-[color:var(--app-teal)]">
          <LockKeyhole className="size-6" aria-hidden="true" />
        </span>
        <div>
          <p className="app-kicker">Acesso protegido</p>
          <h1 className="mt-1 text-2xl font-black text-[color:var(--app-fg)]">
            Reajuste salarial
          </h1>
          <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
            Use a senha do usuário padrão do módulo Unimed. A senha
            administrativa da Unimed não libera esta ferramenta.
          </p>
        </div>
      </div>

      <form onSubmit={unlock} className="space-y-4">
        <label
          htmlFor="reajuste-access-password"
          className="block text-sm font-bold text-[color:var(--app-fg)]"
        >
          Senha padrão
        </label>
        <input
          id="reajuste-access-password"
          aria-describedby={error ? "reajuste-access-error" : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="current-password"
          className="app-input w-full"
          maxLength={72}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {error ? (
          <p
            id="reajuste-access-error"
            role="alert"
            className="rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm font-semibold text-[color:var(--app-fg)]"
          >
            {error}
          </p>
        ) : null}
        <button
          className="app-primary-button flex w-full items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]"
          disabled={submitting}
          type="submit"
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
          {submitting ? "Verificando..." : "Desbloquear módulo"}
        </button>
      </form>
    </section>
  );
}
