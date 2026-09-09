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
        <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold app-text">
                {editingId ? "Editar código" : "Novo código"}
              </h2>
              <p className="mt-1 text-sm app-text-muted">
                {canManage
                  ? "Cadastro manual para consulta na validação."
                  : "Somente administradores alteram códigos."}
              </p>
            </div>
            {editingId ? (
              <button
                type="button"
                onClick={newCodigo}
                className="inline-flex items-center gap-2 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface"
              >
                <Plus className="size-4" aria-hidden="true" />
                Novo
              </button>
            ) : null}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium app-text">
              Código
              <input
                {...form.register("codigo")}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>

            <label className="block text-sm font-medium app-text">
              Horários
              <input
                {...form.register("horariosOriginal")}
                disabled={!canManage}
                placeholder="08:00 12:00 13:00 17:00"
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>

            {Object.values(form.formState.errors).length ? (
              <p className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
                Informe código e 2 ou 4 horários no formato HH:MM.
              </p>
            ) : null}

            {saveMutation.isError ? (
              <p className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
                {saveMutation.error.message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!canManage || saveMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
            >
              <Save className="size-4" aria-hidden="true" />
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          </form>
        </section>

        <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
          <h2 className="text-base font-semibold app-text">
            Importação
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,.json"
              disabled={!canManage}
              className="min-w-0 flex-1 app-radius-md border app-border px-3 py-2 text-sm app-disabled-surface"
            />
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={!canManage || importMutation.isPending}
              className="inline-flex items-center gap-2 app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
            >
              <Upload className="size-4" aria-hidden="true" />
              {importMutation.isPending ? "Importando..." : "Importar"}
            </button>
          </div>

          {importMutation.isError ? (
            <p className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
              {importMutation.error.message}
            </p>
          ) : null}

          {importResult ? (
            <div className="mt-3 grid gap-2 text-sm app-text-muted sm:grid-cols-4">
              <div>Lidas: {importResult.totalLido}</div>
              <div>Importadas: {importResult.importados}</div>
              <div>Ignoradas: {importResult.ignorados}</div>
              <div>Erros: {importResult.erros.length}</div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="overflow-hidden app-radius-lg border app-border app-bg-card app-shadow">
        <table className="w-full text-left text-sm">
          <thead className="app-bg-surface app-text-muted">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Horários</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {codigos.map((codigo) => (
              <tr key={codigo.id} className="border-t app-border">
                <td className="px-4 py-3 font-medium app-text">
                  {codigo.codigo}
                </td>
                <td className="px-4 py-3">{codigo.horariosNormalizado}</td>
                <td className="px-4 py-3">{codigo.origem}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => editCodigo(codigo)}
                      className="inline-flex items-center gap-1 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(codigo)}
                      disabled={!canManage || deleteMutation.isPending}
                      className="inline-flex items-center gap-1 app-radius-md border app-border-danger px-3 py-2 text-sm font-medium app-text-danger hover:bg-red-50 disabled:opacity-50"
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
          <p className="m-4 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
            {deleteMutation.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
