"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
} from "@/lib/jornada/input-format";

const AUTO_FORMAT_KEY = "jornada:auto-formatar";
const INTERJORNADA_KEY = "jornada:validar-interjornada";

const schema = z
  .object({
    horarios: z.string().min(1, "Digite os horarios"),
    sabadoHorarios: z.string().optional(),
    interjornadaAtiva: z.boolean(),
    interjornadaHorarios: z.string().optional(),
    autoFormatar: z.boolean(),
    tipoDia: z.enum(["util", "sabado", "domingo", "feriado"]),
  })
  .superRefine((value, ctx) => {
    const duracao = calcularDuracaoEntrada(value.horarios);
    const exigeSabado = duracao?.duracaoMinutos === 480;

    if (exigeSabado && !value.sabadoHorarios?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sabadoHorarios"],
        message: "Digite a jornada de sábado para completar 44h semanais",
      });
    }

    if (
      value.interjornadaAtiva &&
      !exigeSabado &&
      !value.interjornadaHorarios?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["interjornadaHorarios"],
        message: "Digite a proxima jornada para calcular a interjornada",
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
  id: string;
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
        id: `${principal.id}:${sabado.id}`,
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
      id: record.id,
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

function interjornadaLabel(minutos?: number) {
  if (minutos == null) return "-";
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

async function fetchHistory() {
  const response = await fetch("/api/jornada/historico");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return (await response.json()) as HistoryRecord[];
}

export function JornadaValidationForm() {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      horarios: "",
      sabadoHorarios: "",
      interjornadaAtiva: false,
      interjornadaHorarios: "",
      autoFormatar: true,
      tipoDia: "util",
    },
  });
  const horarios = form.watch("horarios");
  const autoFormatar = form.watch("autoFormatar");
  const interjornadaAtiva = form.watch("interjornadaAtiva");
  const duracaoPrincipal = useMemo(
    () => calcularDuracaoEntrada(horarios),
    [horarios],
  );
  const exigeSabado = duracaoPrincipal?.duracaoMinutos === 480;

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_FORMAT_KEY);
    if (stored != null) {
      form.setValue("autoFormatar", stored === "true");
    }
    const storedInterjornada = window.localStorage.getItem(INTERJORNADA_KEY);
    if (storedInterjornada != null) {
      form.setValue("interjornadaAtiva", storedInterjornada === "true");
    }
  }, [form]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_FORMAT_KEY, String(autoFormatar));
  }, [autoFormatar]);

  useEffect(() => {
    window.localStorage.setItem(INTERJORNADA_KEY, String(interjornadaAtiva));
  }, [interjornadaAtiva]);

  const historicoQuery = useQuery({
    queryKey: ["jornada", "historico"],
    queryFn: fetchHistory,
  });
  const historico = useMemo(
    () => groupHistory(historicoQuery.data ?? []),
    [historicoQuery.data],
  );

  function formatField(
    field: "horarios" | "sabadoHorarios" | "interjornadaHorarios",
  ) {
    if (!form.getValues("autoFormatar")) return;
    form.setValue(field, formatarHorariosEntrada(form.getValues(field) ?? ""), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const formatValue = (value?: string) =>
        formatarHorariosEntrada(value ?? "");
      const horariosFormatados = formatValue(values.horarios);
      const isOitoHoras =
        calcularDuracaoEntrada(horariosFormatados)?.duracaoMinutos === 480;
      const payload = isOitoHoras
        ? {
            modo: "sabado-combinado",
            horarios: horariosFormatados,
            horarios2: formatValue(values.sabadoHorarios),
            validarInterjornada: values.interjornadaAtiva,
          }
        : values.interjornadaAtiva
          ? {
              modo: "interjornada",
              horarios: horariosFormatados,
              horarios2: formatValue(values.interjornadaHorarios),
              validarInterjornada: true,
            }
          : {
              modo: "simples",
              horarios: horariosFormatados,
              tipoDia: values.tipoDia,
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
    },
  });

  const horariosField = form.register("horarios");
  const sabadoField = form.register("sabadoHorarios");
  const interjornadaField = form.register("interjornadaHorarios");

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

          <div className="mt-5 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <input
                type="checkbox"
                {...form.register("interjornadaAtiva")}
                className="size-4 rounded border-neutral-300"
              />
              Validar Interjornada
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <input
                type="checkbox"
                {...form.register("autoFormatar")}
                className="size-4 rounded border-neutral-300"
              />
              Auto-formatar horarios
            </label>
          </div>

          <label className="mt-5 block text-sm font-medium text-neutral-800">
            Horarios da Jornada
            <input
              {...horariosField}
              onBlur={(event) => {
                horariosField.onBlur(event);
                formatField("horarios");
              }}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              placeholder="0800 1200 1400 1620"
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
              : "Digite 2 ou 4 horarios separados por espaco"}
          </p>

          {exigeSabado ? (
            <>
              <label className="mt-4 block text-sm font-medium text-neutral-800">
              Jornada Sábado (4 horas)
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
                  Digite 2 horarios para completar 44h semanais e 220h mensais.
                </p>
              )}
            </>
          ) : null}

          {interjornadaAtiva && !exigeSabado ? (
            <>
              <label className="mt-4 block text-sm font-medium text-neutral-800">
                Proxima jornada
                <input
                  {...interjornadaField}
                  onBlur={(event) => {
                    interjornadaField.onBlur(event);
                    formatField("interjornadaHorarios");
                  }}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                  placeholder="0400 0800 0900 1300"
                />
              </label>
              {form.formState.errors.interjornadaHorarios ? (
                <p className="mt-1 text-xs text-red-700">
                  {form.formState.errors.interjornadaHorarios.message}
                </p>
              ) : null}
            </>
          ) : null}

          {!exigeSabado && !interjornadaAtiva ? (
            <label className="mt-4 block text-sm font-medium text-neutral-800">
              Tipo de dia
              <select
                {...form.register("tipoDia")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              >
                <option value="util">Util</option>
                    <option value="sabado">Sábado</option>
                <option value="domingo">Domingo</option>
                <option value="feriado">Feriado</option>
              </select>
            </label>
          ) : null}

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
                <div
                  className={
                    mutation.data.valido
                      ? "rounded-md border border-green-200 bg-green-50 p-4 text-green-800"
                      : "rounded-md border border-red-200 bg-red-50 p-4 text-red-800"
                  }
                >
                  <div className="whitespace-pre-wrap font-medium">
                    {mutation.data.mensagemInterjornada}
                  </div>
                  <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                    <div>
                      <dt className="text-neutral-500">Código</dt>
                      <dd>
                        {joinCodigos(
                          mutation.data.jornada1.codigo,
                          mutation.data.jornada2.codigo,
                        ) ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Interjornada</dt>
                      <dd>
                        {interjornadaLabel(mutation.data.interjornadaMinutos)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <ResultCard title="Jornada principal" result={mutation.data.jornada1} />
                <ResultCard title="Jornada complementar" result={mutation.data.jornada2} />
              </div>
            ) : (
              <div
                className={
                  mutation.data.valido
                    ? "mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-green-800"
                    : "mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-red-800"
                }
              >
                <div className="whitespace-pre-wrap font-medium">
                  {mutation.data.mensagem}
                </div>
                <ResultDetails result={mutation.data} />
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
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          <History className="size-4" aria-hidden="true" />
          Últimas Validações
        </div>
        {historicoQuery.isLoading ? (
          <p className="mt-4 text-sm text-neutral-600">Carregando histórico...</p>
        ) : historico.length > 0 ? (
          <div className="mt-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {historico.map((item) => {
              const Icon = item.valido ? CheckCircle2 : AlertTriangle;
              return (
                <div key={item.id} className="p-3 text-sm">
                  <div className="text-xs text-neutral-500">
                    [{formatDate(item.createdAt)}] {item.horarios}
                  </div>
                  <div
                    className={
                      item.valido
                        ? "mt-1 flex items-start gap-2 text-green-800"
                        : "mt-1 flex items-start gap-2 text-red-800"
                    }
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span className="whitespace-pre-wrap">{item.mensagem}</span>
                  </div>
                </div>
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
