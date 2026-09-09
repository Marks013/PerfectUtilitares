"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Check, Pencil, Plus, Power, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  jornadaRuleSchema,
  type JornadaRuleFormInput,
  type JornadaRuleFormValues,
} from "@/lib/jornada/rule-schema";

type JornadaRule = JornadaRuleFormValues & {
  id: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

const defaultValues: JornadaRuleFormInput = {
  nome: "",
  duracaoMinutos: 480,
  horasSemanais: 44,
  horasMensais: 220,
  intervaloMin: 60,
  intervaloMax: 120,
  limitePeriodoMinutos: 240,
  diasValidos: ["util"],
  active: true,
};

const diasValidos = [
  { value: "util", label: "Útil" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
  { value: "feriado", label: "Feriado" },
] as const;

function sortRules(rules: JornadaRule[]) {
  return [...rules].sort((a, b) => {
    if (a.active !== b.active) {
      return a.active ? -1 : 1;
    }

    return a.duracaoMinutos - b.duracaoMinutos || a.nome.localeCompare(b.nome);
  });
}

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") {
      return data.error;
    }

    return data.error?.message ?? "Falha ao salvar regra";
  } catch {
    return "Falha ao salvar regra";
  }
}

export function JornadaRulesManager({
  initialRules,
  canManage,
}: {
  initialRules: JornadaRule[];
  canManage: boolean;
}) {
  const [rules, setRules] = useState(() => sortRules(initialRules));
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<JornadaRuleFormInput, unknown, JornadaRuleFormValues>({
    resolver: zodResolver(jornadaRuleSchema),
    defaultValues,
  });
  const horasSemanais = form.watch("horasSemanais");

  useEffect(() => {
    const value = Number(horasSemanais);
    if (Number.isFinite(value) && value > 0) {
      form.setValue("horasMensais", value * 5, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [form, horasSemanais]);

  const editingRule = useMemo(
    () => rules.find((rule) => rule.id === editingId) ?? null,
    [editingId, rules],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: JornadaRuleFormValues) => {
      const response = await fetch(
        editingId ? `/api/jornada/regras/${editingId}` : "/api/jornada/regras",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as JornadaRule;
    },
    onSuccess(rule) {
      setRules((current) => {
        const exists = current.some((item) => item.id === rule.id);
        const next = exists
          ? current.map((item) => (item.id === rule.id ? rule : item))
          : [rule, ...current];

        return sortRules(next);
      });
      setEditingId(null);
      form.reset(defaultValues);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (rule: JornadaRule) => {
      const response = await fetch(`/api/jornada/regras/${rule.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as JornadaRule;
    },
    onSuccess(rule) {
      setRules((current) =>
        sortRules(current.map((item) => (item.id === rule.id ? rule : item))),
      );
      if (editingId === rule.id) {
        setEditingId(null);
        form.reset(defaultValues);
      }
    },
  });

  function editRule(rule: JornadaRule) {
    setEditingId(rule.id);
    form.reset({
      nome: rule.nome,
      duracaoMinutos: rule.duracaoMinutos,
      horasSemanais: rule.horasSemanais,
      horasMensais: rule.horasMensais,
      intervaloMin: rule.intervaloMin,
      intervaloMax: rule.intervaloMax,
      limitePeriodoMinutos: rule.limitePeriodoMinutos,
      diasValidos: rule.diasValidos,
      active: rule.active,
    });
  }

  function newRule() {
    setEditingId(null);
    form.reset(defaultValues);
  }

  const submit = form.handleSubmit((values) => saveMutation.mutate(values));

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
      <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold app-text">
              {editingRule ? "Editar regra" : "Nova regra"}
            </h2>
            <p className="mt-1 text-sm app-text-muted">
              {canManage
                ? "Configuração usada pela validação manual."
                : "Somente administradores alteram regras."}
            </p>
          </div>
          {editingRule ? (
            <button
              type="button"
              onClick={newRule}
              className="inline-flex items-center gap-2 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface"
            >
              <Plus className="size-4" aria-hidden="true" />
              Nova
            </button>
          ) : null}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium app-text">
            Nome
            <input
              {...form.register("nome")}
              disabled={!canManage}
              className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium app-text">
              Duração
              <input
                type="number"
                min={1}
                max={720}
                {...form.register("duracaoMinutos", { valueAsNumber: true })}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>
            <label className="block text-sm font-medium app-text">
              Horas semanais
              <input
                type="number"
                min={1}
                max={168}
                {...form.register("horasSemanais", { valueAsNumber: true })}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>
            <label className="block text-sm font-medium app-text">
              Horas mensais
              <input
                type="number"
                min={1}
                max={744}
                {...form.register("horasMensais", { valueAsNumber: true })}
                disabled={!canManage}
                readOnly
                className="mt-1 w-full app-radius-md border app-border app-bg-surface px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>
            <label className="block text-sm font-medium app-text">
              Status
              <select
                {...form.register("active")}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              >
                <option value="true">Ativa</option>
                <option value="false">Inativa</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium app-text">
              Intervalo mínimo
              <input
                type="number"
                min={0}
                max={720}
                {...form.register("intervaloMin", { valueAsNumber: true })}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>
            <label className="block text-sm font-medium app-text">
              Intervalo máximo
              <input
                type="number"
                min={0}
                max={720}
                {...form.register("intervaloMax", { valueAsNumber: true })}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
            </label>
            <label className="block text-sm font-medium app-text sm:col-span-2">
              Limite por período antes/depois do intervalo (minutos)
              <input
                type="number"
                min={1}
                max={720}
                {...form.register("limitePeriodoMinutos", {
                  valueAsNumber: true,
                })}
                disabled={!canManage}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
              />
              <span className="mt-1 block text-xs font-normal app-text-muted">
                Ex.: 240 = 04:00; 300 = 05:00. Vale para cada bloco trabalhado.
              </span>
            </label>
          </div>

          <fieldset disabled={!canManage} className="space-y-2">
            <legend className="text-sm font-medium app-text">
              Dias válidos
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {diasValidos.map((dia) => (
                <label
                  key={dia.value}
                  className="flex items-center gap-2 app-radius-md border app-border px-3 py-2 text-sm app-text"
                >
                  <input
                    type="checkbox"
                    value={dia.value}
                    {...form.register("diasValidos")}
                  />
                  {dia.label}
                </label>
              ))}
            </div>
          </fieldset>

          {Object.values(form.formState.errors).length ? (
            <p className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
              Revise os campos da regra antes de salvar.
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

      <section className="overflow-x-auto app-radius-lg border app-border app-bg-card app-shadow">
        <table className="w-full text-left text-sm">
          <thead className="app-bg-surface app-text-muted">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Duração</th>
              <th className="px-4 py-3">Intervalo</th>
              <th className="px-4 py-3">Limite por período</th>
              <th className="px-4 py-3">Dias</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-t app-border">
                <td className="px-4 py-3 font-medium app-text">
                  {rule.nome}
                </td>
                <td className="px-4 py-3">{rule.duracaoMinutos} min</td>
                <td className="px-4 py-3">
                  {rule.intervaloMin}-{rule.intervaloMax} min
                </td>
                <td className="px-4 py-3">{rule.limitePeriodoMinutos} min</td>
                <td className="px-4 py-3">{rule.diasValidos.join(", ")}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      rule.active
                        ? "inline-flex items-center gap-1 app-text-success"
                        : "inline-flex items-center gap-1 app-text-muted"
                    }
                  >
                    {rule.active ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <X className="size-4" aria-hidden="true" />
                    )}
                    {rule.active ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => editRule(rule)}
                      className="inline-flex items-center gap-1 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deactivateMutation.mutate(rule)}
                      disabled={!canManage || !rule.active || deactivateMutation.isPending}
                      className="inline-flex items-center gap-1 app-radius-md border app-border-danger px-3 py-2 text-sm font-medium app-text-danger hover:bg-red-50 disabled:opacity-50"
                    >
                      <Power className="size-4" aria-hidden="true" />
                      Inativar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {deactivateMutation.isError ? (
          <p className="m-4 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
            {deactivateMutation.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
