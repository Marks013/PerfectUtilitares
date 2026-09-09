"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Mail } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail cadastrado.")
    .email("Informe um e-mail válido, como nome@empresa.com."),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export function ForgotPasswordForm() {
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="auth-card w-full max-w-sm app-radius-lg border app-border app-bg-card p-6 app-shadow"
    >
      <div className="flex items-center gap-2">
        <Mail className="size-5 app-text-muted" aria-hidden="true" />
        <h1 className="text-xl font-semibold app-text">
          Recuperar senha
        </h1>
      </div>
      <p className="mt-1 text-sm app-text-muted">
        Enviaremos um link para você definir uma nova senha.
      </p>

      <label className="mt-5 block text-sm font-medium app-text">
        E-mail
        <input
          type="email"
          autoComplete="username"
          maxLength={254}
          {...form.register("email")}
          className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          placeholder="nome@empresa.com"
        />
      </label>
      {form.formState.errors.email ? (
        <p className="mt-1 text-xs app-text-danger">
          {form.formState.errors.email.message}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="mt-4 flex items-center gap-2 app-radius-md border app-border-success app-bg-success-soft p-3 text-sm app-text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Se o e-mail estiver cadastrado e ativo, enviaremos um link para redefinir a senha.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-5 w-full app-radius-md app-action-fill px-3 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
      >
        {mutation.isPending ? "Enviando..." : "Enviar link"}
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
