"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  codigoJornadaSchema,
  type CodigoJornadaFormInput,
  type CodigoJornadaFormValues,
} from "@/lib/codigos/schema";

type CodigoJornada = {
  id: string;
  codigo: string;
  horariosOriginal: string;
  horariosNormalizado: string;
  origem: "XLSX" | "CSV" | "JSON" | "MANUAL";
  linha: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type ImportResult = {
  totalLido: number;
  importados: number;
  ignorados: number;
  erros: Array<{ linha: number; mensagem: string }>;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

const defaultValues: CodigoJornadaFormInput = {
  codigo: "",
  horariosOriginal: "",
};

function sortCodigos(codigos: CodigoJornada[]) {
  return [...codigos].sort((a, b) => {
    return (
      b.updatedAt.toString().localeCompare(a.updatedAt.toString()) ||
      a.codigo.localeCompare(b.codigo)
    );
  });
}

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") {
      return data.error;
    }

    return data.error?.message ?? "Falha ao salvar código";
  } catch {
    return "Falha ao salvar código";
  }
}

export function CodigoJornadaManager({
  initialCodigos,
  canManage,
}: {
  initialCodigos: CodigoJornada[];
  canManage: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [codigos, setCodigos] = useState(() => sortCodigos(initialCodigos));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const form = useForm<
    CodigoJornadaFormInput,
    unknown,
    CodigoJornadaFormValues
  >({
    resolver: zodResolver(codigoJornadaSchema),
    defaultValues,
  });

  async function reloadCodigos() {
    const response = await fetch("/api/jornada/codigos");
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    setCodigos(sortCodigos((await response.json()) as CodigoJornada[]));
  }

  const saveMutation = useMutation({
    mutationFn: async (values: CodigoJornadaFormValues) => {
      const response = await fetch(
        editingId ? `/api/jornada/codigos/${editingId}` : "/api/jornada/codigos",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as CodigoJornada;
    },
    onSuccess(codigo) {
      setCodigos((current) => {
        const exists = current.some((item) => item.id === codigo.id);
        const next = exists
          ? current.map((item) => (item.id === codigo.id ? codigo : item))
          : [codigo, ...current];

        return sortCodigos(next);
      });
      setEditingId(null);
      form.reset(defaultValues);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (codigo: CodigoJornada) => {
      const response = await fetch(`/api/jornada/codigos/${codigo.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return codigo.id;
    },
    onSuccess(id) {
      setCodigos((current) => current.filter((codigo) => codigo.id !== id));
      if (editingId === id) {
        setEditingId(null);
        form.reset(defaultValues);
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        throw new Error("Selecione um arquivo .xlsx, .csv ou .json");
      }

      const formData = new FormData();
      formData.set("file", file);

      const response = await fetch("/api/jornada/codigos/import", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as ImportResult;
    },
    async onSuccess(result) {
      setImportResult(result);
      await reloadCodigos();
    },
  });

  function editCodigo(codigo: CodigoJornada) {
    setEditingId(codigo.id);
    form.reset({
      codigo: codigo.codigo,
      horariosOriginal: codigo.horariosOriginal,
    });
  }

  function newCodigo() {
    setEditingId(null);
    form.reset(defaultValues);
  }

  const submit = form.handleSubmit((values) => saveMutation.mutate(values));

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-950">
                {editingId ? "Editar código" : "Novo código"}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {canManage
                  ? "Cadastro manual para consulta na validação."
                  : "Somente administradores alteram códigos."}
              </p>
            </div>
            {editingId ? (
              <button
                type="button"
                onClick={newCodigo}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                Novo
              </button>
            ) : null}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-neutral-800">
              Código
              <input
                {...form.register("codigo")}
                disabled={!canManage}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950 disabled:bg-neutral-100"
              />
            </label>

            <label className="block text-sm font-medium text-neutral-800">
              Horários
              <input
                {...form.register("horariosOriginal")}
                disabled={!canManage}
                placeholder="08:00 12:00 13:00 17:00"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950 disabled:bg-neutral-100"
              />
            </label>

            {Object.values(form.formState.errors).length ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Informe código e 2 ou 4 horários no formato HH:MM.
              </p>
            ) : null}

            {saveMutation.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saveMutation.error.message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!canManage || saveMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              <Save className="size-4" aria-hidden="true" />
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-neutral-950">
            Importação
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,.json"
              disabled={!canManage}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-100"
            />
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={!canManage || importMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              <Upload className="size-4" aria-hidden="true" />
              {importMutation.isPending ? "Importando..." : "Importar"}
            </button>
          </div>

          {importMutation.isError ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {importMutation.error.message}
            </p>
          ) : null}

          {importResult ? (
            <div className="mt-3 grid gap-2 text-sm text-neutral-700 sm:grid-cols-4">
              <div>Lidas: {importResult.totalLido}</div>
              <div>Importadas: {importResult.importados}</div>
              <div>Ignoradas: {importResult.ignorados}</div>
              <div>Erros: {importResult.erros.length}</div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Horários</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {codigos.map((codigo) => (
              <tr key={codigo.id} className="border-t border-neutral-100">
                <td className="px-4 py-3 font-medium text-neutral-900">
                  {codigo.codigo}
                </td>
                <td className="px-4 py-3">{codigo.horariosNormalizado}</td>
                <td className="px-4 py-3">{codigo.origem}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => editCodigo(codigo)}
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(codigo)}
                      disabled={!canManage || deleteMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {deleteMutation.isError ? (
          <p className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {deleteMutation.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
