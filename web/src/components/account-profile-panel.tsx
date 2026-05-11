"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Save, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe seu nome.")
    .min(2, "O nome deve ter pelo menos 2 caracteres.")
    .max(80, "O nome deve ter no máximo 80 caracteres."),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Digite a senha atual"),
    newPassword: z
      .string()
      .min(1, "Digite a nova senha.")
      .min(8, "A nova senha deve ter pelo menos 8 caracteres.")
      .max(BCRYPT_PASSWORD_MAX_LENGTH, "A senha deve ter no máximo 72 caracteres"),
    confirmPassword: z.string().min(1, "Confirme a nova senha."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem. Digite a mesma senha nos dois campos.",
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

type ApiErrorBody = {
  error?: string | { message?: string };
};

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return (
      data.error?.message ??
      "Não foi possível atualizar sua conta. Revise os dados e tente novamente."
    );
  } catch {
    return "Não foi possível atualizar sua conta. Tente novamente em instantes.";
  }
}

export function AccountProfilePanel({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: "ADMIN" | "OPERATOR";
}) {
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name },
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const profileMutation = useMutation({
    mutationFn: async (values: ProfileValues) => {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return response.json() as Promise<{ name: string }>;
    },
    onSuccess(data) {
      profileForm.reset({ name: data.name });
      window.location.reload();
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (values: PasswordValues) => {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }
    },
    onSuccess() {
      passwordForm.reset();
    },
  });

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <form
        onSubmit={profileForm.handleSubmit((values) =>
          profileMutation.mutate(values),
        )}
        className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-neutral-100 text-neutral-800">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-neutral-950">Perfil</h2>
            <p className="mt-1 text-sm text-neutral-600">{email}</p>
            <p className="mt-1 text-xs font-medium uppercase text-neutral-500">
              {role === "ADMIN" ? "Administrador" : "Operador"}
            </p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-neutral-800">
          Nome do usuário
          <input
            {...profileForm.register("name")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          />
        </label>
        {profileForm.formState.errors.name ? (
          <p className="mt-1 text-xs text-red-700">
            {profileForm.formState.errors.name.message}
          </p>
        ) : null}
        {profileMutation.isError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {profileMutation.error.message}
          </p>
        ) : null}
        {profileMutation.isSuccess ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Nome atualizado.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={profileMutation.isPending}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          <Save className="size-4" aria-hidden="true" />
          {profileMutation.isPending ? "Salvando..." : "Salvar nome"}
        </button>
      </form>

      <form
        onSubmit={passwordForm.handleSubmit((values) =>
          passwordMutation.mutate(values),
        )}
        className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-neutral-100 text-neutral-800">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-neutral-950">Senha</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Confirme sua senha atual antes de trocar.
            </p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-neutral-800">
          Senha atual
          <input
            type="password"
            autoComplete="current-password"
            maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
            {...passwordForm.register("currentPassword")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          />
        </label>
        {passwordForm.formState.errors.currentPassword ? (
          <p className="mt-1 text-xs text-red-700">
            {passwordForm.formState.errors.currentPassword.message}
          </p>
        ) : null}

        <label className="mt-4 block text-sm font-medium text-neutral-800">
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
            {...passwordForm.register("newPassword")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          />
        </label>
        {passwordForm.formState.errors.newPassword ? (
          <p className="mt-1 text-xs text-red-700">
            {passwordForm.formState.errors.newPassword.message}
          </p>
        ) : null}

        <label className="mt-4 block text-sm font-medium text-neutral-800">
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
            {...passwordForm.register("confirmPassword")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          />
        </label>
        {passwordForm.formState.errors.confirmPassword ? (
          <p className="mt-1 text-xs text-red-700">
            {passwordForm.formState.errors.confirmPassword.message}
          </p>
        ) : null}

        {passwordMutation.isError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {passwordMutation.error.message}
          </p>
        ) : null}
        {passwordMutation.isSuccess ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Senha atualizada.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={passwordMutation.isPending}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {passwordMutation.isPending ? "Atualizando..." : "Trocar senha"}
        </button>
      </form>
    </section>
  );
}
