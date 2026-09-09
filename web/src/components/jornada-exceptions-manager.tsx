"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  jornadaExceptionSchema,
  type JornadaExceptionFormInput,
  type JornadaExceptionFormValues,
} from "@/lib/jornada/exception-schema";

type UserOption = {
  id: string;
  name: string;
  email: string;
};

type JornadaException = {
  id: string;
  userId: string;
  user: { name: string | null; email: string | null };
  nome: string | null;
  horariosOriginal: string;
  horariosNormalizado: string;
  sabadoOriginal: string | null;
  sabadoNormalizado: string | null;
  active: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

const defaultValues: JornadaExceptionFormInput = {
  userId: "",
  nome: "",
  horarios: "",
  sabadoHorarios: "",
  active: true,
};

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? "Falha ao salvar exceção";
  } catch {
    return "Falha ao salvar exceção";
  }
}

function sortExceptions(items: JornadaException[]) {
  return [...items].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function userLabel(user: JornadaException["user"]) {
  return user.name ?? user.email ?? "Usuário";
}

export function JornadaExceptionsManager({
  initialExceptions,
  users,
}: {
  initialExceptions: JornadaException[];
  users: UserOption[];
}) {
  const [exceptions, setExceptions] = useState(() =>
    sortExceptions(initialExceptions),
  );
  const form = useForm<JornadaExceptionFormInput, unknown, JornadaExceptionFormValues>({
    resolver: zodResolver(jornadaExceptionSchema),
    defaultValues: {
      ...defaultValues,
      userId: users[0]?.id ?? "",
    },
  });
  const activeUsers = useMemo(
    () => users.map((user) => ({ value: user.id, label: `${user.name} (${user.email})` })),
    [users],
  );

  const createMutation = useMutation({
    mutationFn: async (values: JornadaExceptionFormValues) => {
      const response = await fetch("/api/jornada/excecoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: values.userId,
          nome: values.nome ?? "",
          horarios: values.horarios,
          sabadoHorarios: values.sabadoHorarios ?? "",
          active: values.active,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as JornadaException;
    },
    onSuccess(exception) {
      setExceptions((current) => sortExceptions([exception, ...current]));
      form.reset({ ...defaultValues, userId: users[0]?.id ?? "" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (exception: JornadaException) => {
      const response = await fetch(`/api/jornada/excecoes/${exception.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as JornadaException;
    },
    onSuccess(exception) {
      setExceptions((current) =>
        sortExceptions(
          current.map((item) => (item.id === exception.id ? exception : item)),
        ),
      );
    },
  });

  const submit = form.handleSubmit((values) => createMutation.mutate(values));

  return (
    <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold app-text">
            Exceções autorizadas
          </h2>
          <p className="mt-1 max-w-3xl text-sm app-text-muted">
            Autorize um horário exato para um usuário específico. A validação só
            passa quando a escala digitada bater exatamente com a exceção ativa.
          </p>
        </div>
        <ShieldCheck className="size-5 app-text-muted" aria-hidden="true" />
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-3 lg:grid-cols-6">
        <label className="block text-sm font-medium app-text lg:col-span-2">
          Usuário autorizado
          <select
            {...form.register("userId")}
            disabled={!activeUsers.length}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
          >
            {activeUsers.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium app-text lg:col-span-2">
          Nome da exceção
          <input
            {...form.register("nome")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            placeholder="Ex.: escala autorizada gerência"
          />
        </label>
        <label className="block text-sm font-medium app-text lg:col-span-2">
          Segunda a sexta
          <input
            {...form.register("horarios")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            placeholder="08:00 11:30 13:30 18:00"
          />
        </label>
        <label className="block text-sm font-medium app-text lg:col-span-2">
          Sábado opcional
          <input
            {...form.register("sabadoHorarios")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            placeholder="08:00 12:00"
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm font-medium app-text">
          <input
            type="checkbox"
            {...form.register("active")}
            className="size-4 rounded app-border"
          />
          Ativa
        </label>
        <button
          type="submit"
          disabled={!activeUsers.length || createMutation.isPending}
          className="inline-flex items-center justify-center gap-2 self-end app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
          {createMutation.isPending ? "Salvando..." : "Autorizar"}
        </button>
      </form>

      {Object.values(form.formState.errors).length ? (
        <p className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          Revise usuário e horários da exceção.
        </p>
      ) : null}
      {createMutation.isError ? (
        <p className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          {createMutation.error.message}
        </p>
      ) : null}
      {deactivateMutation.isError ? (
        <p className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          {deactivateMutation.error.message}
        </p>
      ) : null}

      <div className="mt-5 overflow-hidden app-radius-lg border app-border">
        <table className="w-full text-left text-sm">
          <thead className="app-bg-surface app-text-muted">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Horário</th>
              <th className="px-4 py-3">Sábado</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((exception) => (
              <tr key={exception.id} className="border-t app-border">
                <td className="px-4 py-3">
                  <div className="font-medium app-text">
                    {userLabel(exception.user)}
                  </div>
                  {exception.nome ? (
                    <div className="text-xs app-text-muted">
                      {exception.nome}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-medium app-text">
                  {exception.horariosNormalizado}
                </td>
                <td className="px-4 py-3">
                  {exception.sabadoNormalizado ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      exception.active
                        ? "inline-flex items-center gap-1 app-text-success"
                        : "app-text-muted"
                    }
                  >
                    {exception.active ? (
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                    ) : null}
                    {exception.active ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => deactivateMutation.mutate(exception)}
                    disabled={!exception.active || deactivateMutation.isPending}
                    className="inline-flex items-center gap-2 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Desativar
                  </button>
                </td>
              </tr>
            ))}
            {exceptions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 app-text-muted">
                  Nenhuma exceção cadastrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
