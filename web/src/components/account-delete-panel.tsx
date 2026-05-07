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
    <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-red-800">Excluir conta</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Esta ação remove seu usuário e encerra o acesso ao sistema.
      </p>

      {mutation.isError ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {mutation.error.message}
        </p>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={mutation.isPending}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60"
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
            <AlertDialogCancel className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mutation.mutate()}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
            >
              Excluir conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
