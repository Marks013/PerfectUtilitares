"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  History,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
} from "@/lib/jornada/input-format";
import { calcularDuracaoMinutos, parseHorario } from "@/lib/jornada/time";

const AUTO_FORMAT_KEY = "jornada:auto-formatar";

const schema = z
  .object({
    horarios: z.string().min(1, "Digite os horarios"),
    sabadoHorarios: z.string().optional(),
    autoFormatar: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (isPrincipalReadyForSaturday(value.horarios) && !value.sabadoHorarios?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sabadoHorarios"],
        message: "Digite a jornada de sábado com exatamente 04:00",
      });
    }
  });

type FormValues = z.infer<typeof schema>;

type JornadaResult = {
  valido: boolean;
  mensagem: string;
  duracaoCalculada?: string;
  codigo?: string;
  intervalo?: string;
  horasSemanais?: number;
  horasMensais?: number;
  horariosNormalizado?: string;
};

type SimpleResponse = JornadaResult & { id?: string };

type CombinedResponse = {
  modo: "interjornada" | "sabado-combinado";
  valido: boolean;
  jornada1: JornadaResult;
  jornada2: JornadaResult;
  mensagemInterjornada: string;
  interjornadaMinutos?: number;
  ids?: string[];
};

type ValidationResponse = SimpleResponse | CombinedResponse;

type HistoryRecord = JornadaResult & {
  id: string;
  horariosOriginal: string;
  horariosNormalizado: string;
  tipoDia: "util" | "sabado" | "domingo" | "feriado";
  createdAt: string;
  user?: { name?: string | null; email?: string | null } | null;
};

type HistoryItem = {
  key: string;
  ids: string[];
  createdAt: string;
  horarios: string;
  valido: boolean;
  mensagem: string;
  codigo?: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? "Falha ao validar jornada";
  } catch {
    return "Falha ao validar jornada";
  }
}

function isCombinedResponse(value: ValidationResponse): value is CombinedResponse {
  return "jornada1" in value && "jornada2" in value;
}

function joinCodigos(...codigos: Array<string | undefined>) {
  const values = codigos.filter(Boolean);
  return values.length > 0 ? values.join(" + ") : undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function isPrincipalReadyForSaturday(value: string) {
  const duracao = calcularDuracaoEntrada(value);
  if (duracao?.duracaoMinutos !== 480) return false;

  const pontos = duracao.horariosNormalizado.split(" ");
  if (pontos.length !== 4) return false;

  const parsed = pontos.map(parseHorario);
  if (parsed.some((item) => item == null)) return false;

  const [inicio1, fim1, inicio2, fim2] = parsed as number[];
  const periodo1 = calcularDuracaoMinutos(inicio1, fim1);
  const periodo2 = calcularDuracaoMinutos(inicio2, fim2);
  const intervalo = calcularDuracaoMinutos(fim1, inicio2);

  return periodo1 <= 240 && periodo2 <= 240 && intervalo >= 60 && intervalo <= 120;
}

function groupHistory(records: HistoryRecord[]): HistoryItem[] {
  const used = new Set<string>();
  const grouped: HistoryItem[] = [];

  records.forEach((record, index) => {
    if (used.has(record.id)) return;

    const pair = records.slice(index + 1, index + 4).find((candidate) => {
      if (used.has(candidate.id)) return false;
      const diff = Math.abs(
        new Date(record.createdAt).getTime() -
          new Date(candidate.createdAt).getTime(),
      );
      return (
        diff <= 3_000 &&
        ((record.tipoDia === "sabado" && candidate.tipoDia === "util") ||
          (record.tipoDia === "util" && candidate.tipoDia === "sabado"))
      );
    });

    if (pair) {
      used.add(record.id);
      used.add(pair.id);
      const sabado = record.tipoDia === "sabado" ? record : pair;
      const principal = record.tipoDia === "sabado" ? pair : record;
      const codigo = joinCodigos(principal.codigo, sabado.codigo);

      grouped.push({
        key: `${principal.id}:${sabado.id}`,
        ids: [principal.id, sabado.id],
        createdAt: principal.createdAt,
        horarios: `${principal.horariosOriginal} + Sábado: ${sabado.horariosOriginal}`,
        valido: principal.valido && sabado.valido,
        mensagem: `${sabado.mensagem}${codigo ? ` (Código: ${codigo})` : ""}`,
        codigo,
      });
      return;
    }

    used.add(record.id);
    grouped.push({
      key: record.id,
      ids: [record.id],
      createdAt: record.createdAt,
      horarios: record.horariosOriginal,
      valido: record.valido,
      mensagem: `${record.mensagem}${record.codigo ? ` (Código: ${record.codigo})` : ""}`,
      codigo: record.codigo,
    });
  });

  return grouped.slice(0, 8);
}

function ResultDetails({ result }: { result: JornadaResult }) {
  return (
    <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="text-neutral-500">Duração</dt>
        <dd>{result.duracaoCalculada ?? "-"}</dd>
      </div>
      <div>
        <dt className="text-neutral-500">Código</dt>
        <dd>{result.codigo ?? "-"}</dd>
      </div>
      <div>
        <dt className="text-neutral-500">Intervalo</dt>
        <dd>{result.intervalo ?? "-"}</dd>
      </div>
      <div>
        <dt className="text-neutral-500">Horas semanais</dt>
        <dd>{result.horasSemanais ?? "-"}</dd>
      </div>
      <div>
        <dt className="text-neutral-500">Horas mensais</dt>
        <dd>{result.horasMensais ?? "-"}</dd>
      </div>
    </dl>
  );
}

function ResultCard({
  title,
  result,
}: {
  title: string;
  result: JornadaResult;
}) {
  const Icon = result.valido ? CheckCircle2 : AlertTriangle;

  return (
    <div
      className={
        result.valido
          ? "rounded-md border border-green-200 bg-green-50 p-4 text-green-800"
          : "rounded-md border border-red-200 bg-red-50 p-4 text-red-800"
      }
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-neutral-500">
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </div>
      <div className="mt-1 whitespace-pre-wrap font-medium">
        {result.mensagem}
      </div>
      <ResultDetails result={result} />
    </div>
  );
}

async function fetchHistory() {
  const response = await fetch("/api/jornada/historico");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return (await response.json()) as HistoryRecord[];
}

async function downloadPdf(ids: string[]) {
  const response = await fetch("/api/jornada/historico/exportar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "historico-jornadas.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function JornadaValidationForm() {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      horarios: "",
      sabadoHorarios: "",
      autoFormatar: true,
    },
  });
  const horarios = form.watch("horarios");
  const autoFormatar = form.watch("autoFormatar");
  const duracaoPrincipal = useMemo(
    () => calcularDuracaoEntrada(horarios),
    [horarios],
  );
  const canShowSabado = useMemo(
    () => isPrincipalReadyForSaturday(horarios),
    [horarios],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_FORMAT_KEY);
    if (stored != null) {
      form.setValue("autoFormatar", stored === "true");
    }
  }, [form]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_FORMAT_KEY, String(autoFormatar));
  }, [autoFormatar]);

  useEffect(() => {
    if (!canShowSabado) {
      form.setValue("sabadoHorarios", "");
    }
  }, [canShowSabado, form]);

  const historicoQuery = useQuery({
    queryKey: ["jornada", "historico"],
    queryFn: fetchHistory,
  });
  const historico = useMemo(
    () => groupHistory(historicoQuery.data ?? []),
    [historicoQuery.data],
  );
  const exportable = useMemo(
    () => historico.filter((item) => item.valido),
    [historico],
  );
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const allExportableSelected =
    exportable.length > 0 &&
    exportable.every((item) => selectedSet.has(item.key));

  function formatField(field: "horarios" | "sabadoHorarios") {
    if (!form.getValues("autoFormatar")) return;
    form.setValue(field, formatarHorariosEntrada(form.getValues(field) ?? ""), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleAllExportable() {
    setSelectedKeys(
      allExportableSelected ? [] : exportable.map((item) => item.key),
    );
  }

  function toggleOne(item: HistoryItem) {
    if (!item.valido) return;

    setSelectedKeys((current) =>
      current.includes(item.key)
        ? current.filter((key) => key !== item.key)
        : [...current, item.key],
    );
  }

  async function exportSelected() {
    setExportError(null);
    setIsExporting(true);
    try {
      const ids = historico
        .filter((item) => selectedSet.has(item.key) && item.valido)
        .flatMap((item) => item.ids);
      await downloadPdf(ids);
    } catch (exception) {
      setExportError(
        exception instanceof Error ? exception.message : "Falha ao exportar PDF",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const horariosFormatados = formatarHorariosEntrada(values.horarios);
      const payload = isPrincipalReadyForSaturday(horariosFormatados)
        ? {
            modo: "sabado-combinado",
            horarios: horariosFormatados,
            horarios2: formatarHorariosEntrada(values.sabadoHorarios ?? ""),
            validarInterjornada: false,
          }
        : {
            modo: "simples",
            horarios: horariosFormatados,
          };

      const response = await fetch("/api/jornada/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as ValidationResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jornada", "historico"] });
      setSelectedKeys([]);
    },
  });

  const horariosField = form.register("horarios");
  const sabadoField = form.register("sabadoHorarios");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[460px_1fr]">
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-neutral-950">
            Validar jornada
          </h1>

          <label className="mt-5 block text-sm font-medium text-neutral-800">
            Horários de segunda a sexta
            <input
              {...horariosField}
              onBlur={(event) => {
                horariosField.onBlur(event);
                formatField("horarios");
              }}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              placeholder="0800 1200 1300 1700"
            />
          </label>
          {form.formState.errors.horarios ? (
            <p className="mt-1 text-xs text-red-700">
              {form.formState.errors.horarios.message}
            </p>
          ) : null}
          <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {duracaoPrincipal
              ? `Duração detectada: ${duracaoPrincipal.duracaoFormatada}`
              : "Digite 2 ou 4 horários separados por espaço"}
          </p>

          {canShowSabado ? (
            <>
              <label className="mt-4 block text-sm font-medium text-neutral-800">
                Complemento de sábado
                <input
                  {...sabadoField}
                  onBlur={(event) => {
                    sabadoField.onBlur(event);
                    formatField("sabadoHorarios");
                  }}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                  placeholder="0800 1200"
                />
              </label>
              {form.formState.errors.sabadoHorarios ? (
                <p className="mt-1 text-xs text-red-700">
                  {form.formState.errors.sabadoHorarios.message}
                </p>
              ) : (
                <p className="mt-1 text-xs text-emerald-700">
                  A jornada principal está apta; informe 04:00 no sábado para
                  completar 44h semanais.
                </p>
              )}
            </>
          ) : null}

          <label className="mt-5 flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              {...form.register("autoFormatar")}
              className="size-4 rounded border-neutral-300"
            />
            Auto-formatar horários
          </label>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {mutation.isPending ? "Validando..." : "Validar"}
          </button>
        </form>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-neutral-800">Resultado</h2>
          {mutation.isError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {mutation.error.message}
            </div>
          ) : null}
          {mutation.data ? (
            isCombinedResponse(mutation.data) ? (
              <div className="mt-4 space-y-3">
                <ResultCard title="Resumo" result={{
                  valido: mutation.data.valido,
                  mensagem: mutation.data.mensagemInterjornada,
                  codigo: joinCodigos(
                    mutation.data.jornada1.codigo,
                    mutation.data.jornada2.codigo,
                  ),
                  intervalo:
                    mutation.data.interjornadaMinutos == null
                      ? undefined
                      : `${Math.floor(mutation.data.interjornadaMinutos / 60)}h${String(
                          mutation.data.interjornadaMinutos % 60,
                        ).padStart(2, "0")}`,
                }} />
                <ResultCard
                  title="Segunda a sexta"
                  result={mutation.data.jornada1}
                />
                <ResultCard
                  title="Sábado"
                  result={mutation.data.jornada2}
                />
              </div>
            ) : (
              <div className="mt-4">
                <ResultCard title="Segunda a sexta" result={mutation.data} />
              </div>
            )
          ) : (
            <p className="mt-4 text-sm text-neutral-600">
              O resultado da validação aparecerá aqui.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <History className="size-4" aria-hidden="true" />
            Últimas Validações
          </div>
          <button
            type="button"
            onClick={exportSelected}
            disabled={selectedKeys.length === 0 || isExporting}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            Gerar PDF
          </button>
        </div>
        {exportError ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {exportError}
          </div>
        ) : null}
        {historicoQuery.isLoading ? (
          <p className="mt-4 text-sm text-neutral-600">Carregando histórico...</p>
        ) : historico.length > 0 ? (
          <div className="mt-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            <label className="flex items-center gap-2 p-3 text-xs font-medium text-neutral-600">
              <input
                type="checkbox"
                checked={allExportableSelected}
                onChange={toggleAllExportable}
                disabled={exportable.length === 0}
                className="size-4 rounded border-neutral-300"
              />
              Selecionar validações válidas exibidas
            </label>
            {historico.map((item) => {
              const Icon = item.valido ? CheckCircle2 : AlertTriangle;
              return (
                <label
                  key={item.key}
                  className="flex gap-3 p-3 text-sm"
                  aria-disabled={!item.valido}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.key)}
                    onChange={() => toggleOne(item)}
                    disabled={!item.valido}
                    aria-label={`Selecionar jornada ${item.horarios}`}
                    className="mt-1 size-4 rounded border-neutral-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-neutral-500">
                      [{formatDate(item.createdAt)}] {item.horarios}
                    </span>
                    <span
                      className={
                        item.valido
                          ? "mt-1 flex items-start gap-2 text-green-800"
                          : "mt-1 flex items-start gap-2 text-red-800"
                      }
                    >
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span className="whitespace-pre-wrap">{item.mensagem}</span>
                    </span>
                    {!item.valido ? (
                      <span className="mt-1 block text-xs text-neutral-500">
                        Jornadas com erro não podem ser selecionadas para PDF.
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-neutral-600">
            Nenhuma validação registrada ainda.
          </p>
        )}
      </section>
    </div>
  );
}
