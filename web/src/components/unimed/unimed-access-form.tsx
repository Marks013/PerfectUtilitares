"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type UnimedAccessFormProps = {
  nextPath: string;
};

export function UnimedAccessForm({ nextPath }: UnimedAccessFormProps) {
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
      const response = await fetch("/api/unimed/access/session", {
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
          <h1 className="text-2xl font-black text-[color:var(--app-fg)]">
            Acesso Unimed
          </h1>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            Digite a senha do módulo. O acesso será identificado e
            registrado automaticamente.
          </p>
        </div>
      </div>

      <form onSubmit={unlock} className="space-y-4">
        <label className="block text-sm font-bold text-[color:var(--app-fg)]">
          Senha
          <input
            autoComplete="current-password"
            autoFocus
            className="app-input mt-2 w-full"
            maxLength={72}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {error}
          </p>
        ) : null}
        <button
          className="app-primary-button flex w-full items-center justify-center gap-2"
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
