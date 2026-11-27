"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";

type ApiErrorBody = {
  error?: string | { message?: string };
};

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? "Falha ao excluir conta";
  } catch {
    return "Falha ao excluir conta";
  }
}

export function AccountDeletePanel({ email }: { email: string }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }
    },
    onSuccess() {
      window.location.href = "/login";
    },
  });

  return (
    <section className="app-radius-lg border app-border-danger app-bg-card p-5 app-shadow">
      <h2 className="text-base font-semibold app-text-danger">Excluir conta</h2>
      <p className="mt-1 text-sm app-text-muted">
        Esta ação remove seu usuário e encerra o acesso ao sistema.
      </p>

      <ConfirmAction
        title="Excluir sua conta?"
        description={`Esta ação remove definitivamente a conta ${email} e encerra seu acesso.`}
        confirmLabel="Excluir conta"
        onConfirm={() => mutation.mutateAsync()}
      >
        <button
          type="button"
          disabled={mutation.isPending}
          className="mt-4 inline-flex min-h-11 items-center gap-2 app-radius-md border app-border-danger app-bg-danger-soft px-4 py-2 text-sm font-medium app-text-danger app-hover-surface disabled:opacity-60"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Excluir minha conta
        </button>
      </ConfirmAction>
    </section>
  );
}
