"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

type ApiErrorBody = {
  error?: string | { message?: string };
};

const acceptFormSchema = z
  .object({
    password: z
      .string()
      .min(1, "Informe a senha.")
      .min(8, "A senha deve ter pelo menos 8 caracteres.")
      .max(BCRYPT_PASSWORD_MAX_LENGTH, "A senha deve ter no máximo 72 caracteres."),
    confirmPassword: z
      .string()
      .min(1, "Confirme a senha.")
      .min(8, "A confirmação deve ter pelo menos 8 caracteres.")
      .max(BCRYPT_PASSWORD_MAX_LENGTH, "A senha deve ter no máximo 72 caracteres."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem. Digite a mesma senha nos dois campos.",
  });

type AcceptFormInput = z.input<typeof acceptFormSchema>;
type AcceptFormValues = z.output<typeof acceptFormSchema>;

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return (
      data.error?.message ??
      "Não foi possível definir a senha. Verifique os dados e tente novamente."
    );
  } catch {
    return "Não foi possível definir a senha. Tente novamente em instantes.";
  }
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const form = useForm<AcceptFormInput, unknown, AcceptFormValues>({
    resolver: zodResolver(acceptFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: AcceptFormValues) => {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return response.json();
    },
    onSuccess() {
      form.reset();
      void signOut({ callbackUrl: "/login" });
    },
  });

  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <form
      onSubmit={submit}
      className="auth-card w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-neutral-500" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-neutral-950">Definir senha</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        Crie ou redefina sua senha para acessar o sistema.
      </p>

      <label className="mt-5 block text-sm font-medium text-neutral-800">
        Senha
        <input
          type="password"
          autoComplete="new-password"
          maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
          {...form.register("password")}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          placeholder="Mínimo de 8 caracteres"
        />
      </label>
      {form.formState.errors.password ? (
        <p className="mt-1 text-xs text-red-700">
          {form.formState.errors.password.message}
        </p>
      ) : null}

      <label className="mt-4 block text-sm font-medium text-neutral-800">
        Confirmar senha
        <input
          type="password"
          autoComplete="new-password"
          maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
          {...form.register("confirmPassword")}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          placeholder="Repita a senha"
        />
      </label>
      {form.formState.errors.confirmPassword ? (
        <p className="mt-1 text-xs text-red-700">
          {form.formState.errors.confirmPassword.message}
        </p>
      ) : null}

      {mutation.isError ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mutation.error.message}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Senha definida.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-5 w-full rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {mutation.isPending ? "Salvando..." : "Salvar senha"}
      </button>

      <Link
        href="/login"
        className="mt-3 inline-flex w-full justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Voltar ao login
      </Link>
    </form>
  );
}
