"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

      {mutation.isError ? (
        <p className="mt-4 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          {mutation.error.message}
        </p>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={mutation.isPending}
            className="mt-4 inline-flex items-center gap-2 app-radius-md app-bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {mutation.isPending ? "Excluindo..." : "Excluir minha conta"}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir sua conta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove definitivamente a conta {email} e encerra seu acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="app-radius-md border app-border px-4 py-2 text-sm font-medium app-text app-hover-surface">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mutation.mutate()}
              className="app-radius-md app-bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
            >
              Excluir conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
