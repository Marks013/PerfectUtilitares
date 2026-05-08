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
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-950">
            Exceções autorizadas
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-600">
            Autorize um horário exato para um usuário específico. A validação só
            passa quando a escala digitada bater exatamente com a exceção ativa.
          </p>
        </div>
        <ShieldCheck className="size-5 text-neutral-500" aria-hidden="true" />
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-3 lg:grid-cols-6">
        <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
          Usuário autorizado
          <select
            {...form.register("userId")}
            disabled={!activeUsers.length}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950 disabled:bg-neutral-100"
          >
            {activeUsers.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
          Nome da exceção
          <input
            {...form.register("nome")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            placeholder="Ex.: escala autorizada gerência"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
          Segunda a sexta
          <input
            {...form.register("horarios")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            placeholder="08:00 11:30 13:30 18:00"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
          Sábado opcional
          <input
            {...form.register("sabadoHorarios")}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            placeholder="08:00 12:00"
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm font-medium text-neutral-800">
          <input
            type="checkbox"
            {...form.register("active")}
            className="size-4 rounded border-neutral-300"
          />
          Ativa
        </label>
        <button
          type="submit"
          disabled={!activeUsers.length || createMutation.isPending}
          className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
          {createMutation.isPending ? "Salvando..." : "Autorizar"}
        </button>
      </form>

      {Object.values(form.formState.errors).length ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Revise usuário e horários da exceção.
        </p>
      ) : null}
      {createMutation.isError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {createMutation.error.message}
        </p>
      ) : null}
      {deactivateMutation.isError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {deactivateMutation.error.message}
        </p>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-lg border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
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
              <tr key={exception.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-neutral-900">
                    {userLabel(exception.user)}
                  </div>
                  {exception.nome ? (
                    <div className="text-xs text-neutral-500">
                      {exception.nome}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-medium text-neutral-900">
                  {exception.horariosNormalizado}
                </td>
                <td className="px-4 py-3">
                  {exception.sabadoNormalizado ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      exception.active
                        ? "inline-flex items-center gap-1 text-green-700"
                        : "text-neutral-500"
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
                    className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Desativar
                  </button>
                </td>
              </tr>
            ))}
            {exceptions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-neutral-500">
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

