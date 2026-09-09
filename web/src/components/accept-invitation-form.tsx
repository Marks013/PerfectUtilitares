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
      className="auth-card w-full max-w-sm app-radius-lg border app-border app-bg-card p-6 app-shadow"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 app-text-muted" aria-hidden="true" />
        <h1 className="text-xl font-semibold app-text">Definir senha</h1>
      </div>
      <p className="mt-1 text-sm app-text-muted">
        Crie ou redefina sua senha para acessar o sistema.
      </p>

      <label className="mt-5 block text-sm font-medium app-text">
        Senha
        <input
          type="password"
          autoComplete="new-password"
          maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
          {...form.register("password")}
          className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none focus:border-neutral-900"
          placeholder="Mínimo de 8 caracteres"
        />
      </label>
      {form.formState.errors.password ? (
        <p className="mt-1 text-xs app-text-danger">
          {form.formState.errors.password.message}
        </p>
      ) : null}

      <label className="mt-4 block text-sm font-medium app-text">
        Confirmar senha
        <input
          type="password"
          autoComplete="new-password"
          maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
          {...form.register("confirmPassword")}
          className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none focus:border-neutral-900"
          placeholder="Repita a senha"
        />
      </label>
      {form.formState.errors.confirmPassword ? (
        <p className="mt-1 text-xs app-text-danger">
          {form.formState.errors.confirmPassword.message}
        </p>
      ) : null}

      {mutation.isError ? (
        <p className="mt-4 app-radius-md border app-border-danger app-bg-danger-soft px-3 py-2 text-sm app-text-danger">
          {mutation.error.message}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="mt-4 flex items-center gap-2 app-radius-md border app-border-success app-bg-success-soft px-3 py-2 text-sm app-text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Senha definida.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-5 w-full app-radius-md app-action-fill px-3 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
      >
        {mutation.isPending ? "Salvando..." : "Salvar senha"}
      </button>

      <Link
        href="/login"
        className="mt-3 inline-flex w-full justify-center app-radius-md border app-border px-3 py-2 text-sm font-medium app-text-muted app-hover-surface"
      >
        Voltar ao login
      </Link>
    </form>
  );
}
