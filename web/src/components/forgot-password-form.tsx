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
      className="auth-card w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-neutral-500" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-neutral-950">
          Recuperar senha
        </h1>
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        Enviaremos um link para você definir uma nova senha.
      </p>

      <label className="mt-5 block text-sm font-medium text-neutral-800">
        E-mail
        <input
          type="email"
          autoComplete="username"
          maxLength={254}
          {...form.register("email")}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          placeholder="nome@empresa.com"
        />
      </label>
      {form.formState.errors.email ? (
        <p className="mt-1 text-xs text-red-700">
          {form.formState.errors.email.message}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Se o e-mail estiver cadastrado e ativo, enviaremos um link para redefinir a senha.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-5 w-full rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {mutation.isPending ? "Enviando..." : "Enviar link"}
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
