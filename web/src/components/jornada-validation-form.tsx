"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  History,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
} from "@/lib/jornada/input-format";
import { validarJornadaManual } from "@/lib/jornada/validator";

const AUTO_FORMAT_KEY = "jornada:auto-formatar";
const HISTORY_PAGE_SIZE = 10;
const INTERJORNADA_HELP_TEXT =
  "O intervalo interjornada é o período mínimo de descanso de 11 horas entre o fim de uma jornada de trabalho e o início da seguinte, garantindo saúde, segurança e bem-estar do trabalhador.";

function getAutoFormatStorageKey(userId: string) {
  return `${AUTO_FORMAT_KEY}:${userId}`;
}

const schema = z
  .object({
    horarios: z.string().min(1, "Digite os horarios"),
    segundaJornadaHorarios: z.string().optional(),
    sabadoHorarios: z.string().optional(),
    autoFormatar: z.boolean(),
    interjornadaAtiva: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.interjornadaAtiva && !value.segundaJornadaHorarios?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["segundaJornadaHorarios"],
        message: "Digite a segunda jornada para validar a interjornada.",
      });
      return;
    }

    if (
      !value.interjornadaAtiva &&
      isValidPrincipalEightHours(value.horarios) &&
      !value.sabadoHorarios?.trim()
    ) {
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

const historyQueryKey = ["jornada", "historico"] as const;

type HistoryItem = {
  key: string;
  ids: string[];
  createdAt: string;
  horarios: string;
  valido: boolean;
  mensagem: string;
  codigo?: string;
};

type PdfPerson = {
  localId: string;
  nome: string;
  matricula: string;
  dataAlteracao: string;
};

type PdfExportEntry = {
  ids: string[];
  nome: string;
  matricula: string;
  dataAlteracao: string;
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

function parseDurationMinutes(value?: string) {
  const match = value?.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatDurationMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

function sumDurations(...values: Array<string | undefined>) {
  const minutes = values.map(parseDurationMinutes);
  if (minutes.some((value) => value == null)) return undefined;

  return formatDurationMinutes(
    minutes.reduce<number>((total, value) => total + (value ?? 0), 0),
  );
}

function getCombinedWeeklyHours(result: CombinedResponse) {
  return result.modo === "sabado-combinado"
    ? result.jornada2.horasSemanais
    : undefined;
}

function getCombinedMonthlyHours(result: CombinedResponse) {
  return result.modo === "sabado-combinado"
    ? result.jornada2.horasMensais
    : undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function splitMessage(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getPrimaryMessage(value: string) {
  return splitMessage(value)[0] ?? value;
}

function getSecondaryMessages(value: string) {
  return splitMessage(value).slice(1);
}

function isValidPrincipalEightHours(value: string) {
  const result = validarJornadaManual({
    horarios: formatarHorariosEntrada(value),
    tipoDia: "util",
  });

  return result.valido && result.duracaoCalculada === "08:00";
}

function isEightHourWeekday(record: HistoryRecord) {
  if (record.tipoDia !== "util") return false;
  return (
    calcularDuracaoEntrada(record.horariosNormalizado)?.duracaoMinutos === 480
  );
}

function canGroupWithSaturday(record: HistoryRecord, candidate: HistoryRecord) {
  const principal = record.tipoDia === "sabado" ? candidate : record;
  return isEightHourWeekday(principal);
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
        canGroupWithSaturday(record, candidate) &&
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

  return grouped;
}

function ResultDetails({
  result,
  intervalLabel = "Intervalo",
}: {
  result: JornadaResult;
  intervalLabel?: string;
}) {
  const details = [
    ["Duração", result.duracaoCalculada ?? "-"],
    ["Código", result.codigo ?? "-"],
    [intervalLabel, result.intervalo ?? "-"],
    ["Horas semanais", result.horasSemanais ?? "-"],
    ["Horas mensais", result.horasMensais ?? "-"],
  ];

  return (
    <dl className="jornada-result-details">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultCard({
  title,
  result,
  intervalLabel,
}: {
  title: string;
  result: JornadaResult;
  intervalLabel?: string;
}) {
  const Icon = result.valido ? CheckCircle2 : AlertTriangle;
  const messages = splitMessage(result.mensagem);
  const primary = messages[0] ?? result.mensagem;
  const secondary = messages.slice(1);

  return (
    <div className="jornada-result-card" data-valid={result.valido}>
      <div className="jornada-result-card__heading">
        <span className="jornada-result-card__icon">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span>{title}</span>
      </div>
      <div className="jornada-result-card__message">
        <p>{primary}</p>
        {secondary.length > 0 ? (
          <ul>
            {secondary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <ResultDetails result={result} intervalLabel={intervalLabel} />
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

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function createLocalId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  const randomValues = globalThis.crypto?.getRandomValues;
  if (typeof randomValues === "function") {
    const bytes = new Uint8Array(16);
    randomValues.call(globalThis.crypto, bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createPdfPerson(): PdfPerson {
  return {
    localId: createLocalId(),
    nome: "",
    matricula: "",
    dataAlteracao: todayInputValue(),
  };
}

async function downloadPdf(entries: PdfExportEntry[]) {
  const response = await fetch("/api/jornada/historico/exportar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "alteracao-de-jornada.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function clearOwnHistory() {
  const response = await fetch("/api/jornada/historico?scope=mine", {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as { deletedCount: number };
}

async function deleteSelectedHistory(ids: string[]) {
  const response = await fetch("/api/jornada/historico?scope=selected", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as { deletedCount: number };
}

export function JornadaValidationForm({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [pdfPeopleByKey, setPdfPeopleByKey] = useState<Record<string, PdfPerson[]>>({});
  const [historyPage, setHistoryPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [hideInvalidHistory, setHideInvalidHistory] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      horarios: "",
      segundaJornadaHorarios: "",
      sabadoHorarios: "",
      autoFormatar: true,
      interjornadaAtiva: false,
    },
  });
  const horarios = form.watch("horarios");
  const segundaJornadaHorarios = form.watch("segundaJornadaHorarios");
  const autoFormatar = form.watch("autoFormatar");
  const interjornadaAtiva = form.watch("interjornadaAtiva");
  const duracaoPrincipal = useMemo(
    () => calcularDuracaoEntrada(horarios),
    [horarios],
  );
  const duracaoSegundaJornada = useMemo(
    () => calcularDuracaoEntrada(segundaJornadaHorarios ?? ""),
    [segundaJornadaHorarios],
  );
  const canShowSabado = useMemo(
    () => !interjornadaAtiva && isValidPrincipalEightHours(horarios),
    [horarios, interjornadaAtiva],
  );
  const autoFormatStorageKey = getAutoFormatStorageKey(userId);

  useEffect(() => {
    const stored =
      window.localStorage.getItem(autoFormatStorageKey) ??
      window.localStorage.getItem(AUTO_FORMAT_KEY);
    if (stored != null) {
      form.setValue("autoFormatar", stored === "true");
    }
  }, [autoFormatStorageKey, form]);

  useEffect(() => {
    window.localStorage.setItem(autoFormatStorageKey, String(autoFormatar));
  }, [autoFormatStorageKey, autoFormatar]);

  useEffect(() => {
    if (!canShowSabado) {
      form.setValue("sabadoHorarios", "");
    }
  }, [canShowSabado, form]);

  useEffect(() => {
    if (!interjornadaAtiva) {
      form.setValue("segundaJornadaHorarios", "");
    }
  }, [interjornadaAtiva, form]);

  const historicoQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchHistory,
  });
  const historico = useMemo(
    () => groupHistory(historicoQuery.data ?? []),
    [historicoQuery.data],
  );
  const filteredHistorico = useMemo(
    () =>
      hideInvalidHistory
        ? historico.filter((item) => item.valido)
        : historico,
    [hideInvalidHistory, historico],
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil(filteredHistorico.length / HISTORY_PAGE_SIZE),
  );
  const visibleHistorico = useMemo(
    () =>
      filteredHistorico.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [filteredHistorico, historyPage],
  );
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedItemCount = historico.filter((item) =>
    selectedSet.has(item.key),
  ).length;
  const selectedValidCount = historico.filter(
    (item) => item.valido && selectedSet.has(item.key),
  ).length;
  const selectedErrorCount = selectedItemCount - selectedValidCount;
  const selectionMode =
    selectedItemCount === 0
      ? null
      : selectedValidCount === selectedItemCount
      ? "valid"
      : "invalid";
  const bulkSelectionMode =
    selectionMode ??
    (visibleHistorico.length > 0 && visibleHistorico.every((item) => item.valido)
      ? "valid"
      : visibleHistorico.length > 0 &&
        visibleHistorico.every((item) => !item.valido)
      ? "invalid"
      : null);
  const selectedHistoryIds = useMemo(() => {
    const ids = historico
      .filter((item) => selectedSet.has(item.key))
      .flatMap((item) => item.ids);
    return [...new Set(ids)];
  }, [historico, selectedSet]);
  const selectableVisibleHistorico = useMemo(() => {
    if (bulkSelectionMode === "valid") {
      return visibleHistorico.filter((item) => item.valido);
    }
    if (bulkSelectionMode === "invalid") {
      return visibleHistorico.filter((item) => !item.valido);
    }
    return [];
  }, [bulkSelectionMode, visibleHistorico]);
  const allVisibleSelected =
    selectableVisibleHistorico.length > 0 &&
    selectableVisibleHistorico.every((item) => selectedSet.has(item.key));
  const totalValidCount = historico.filter((item) => item.valido).length;
  const totalErrorCount = historico.length - totalValidCount;

  useEffect(() => {
    if (historyPage > historyPageCount) {
      setHistoryPage(historyPageCount);
    }
  }, [historyPage, historyPageCount]);

  function formatField(
    field: "horarios" | "segundaJornadaHorarios" | "sabadoHorarios",
  ) {
    if (!form.getValues("autoFormatar")) return;
    form.setValue(field, formatarHorariosEntrada(form.getValues(field) ?? ""), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleAllVisible() {
    if (!bulkSelectionMode) return;

    if (allVisibleSelected) {
      const visibleKeys = new Set(
        selectableVisibleHistorico.map((item) => item.key),
      );
      setSelectedKeys((current) =>
        current.filter((key) => !visibleKeys.has(key)),
      );
      setPdfPeopleByKey((current) => {
        const next = { ...current };
        visibleKeys.forEach((key) => {
          delete next[key];
        });
        return next;
      });
      return;
    }

    setSelectedKeys((current) => [
      ...new Set([
        ...current,
        ...selectableVisibleHistorico.map((item) => item.key),
      ]),
    ]);
    setPdfPeopleByKey((current) => {
      const next = { ...current };
      selectableVisibleHistorico.forEach((item) => {
        if (item.valido) {
          next[item.key] = next[item.key] ?? [createPdfPerson()];
        }
      });
      return next;
    });
  }

  function toggleOne(item: HistoryItem) {
    if (
      selectionMode === "valid" && !item.valido && !selectedSet.has(item.key)
    ) {
      return;
    }
    if (
      selectionMode === "invalid" && item.valido && !selectedSet.has(item.key)
    ) {
      return;
    }

    setSelectedKeys((current) => {
      const selected = current.includes(item.key);
      if (selected) {
        setPdfPeopleByKey((people) => {
          const next = { ...people };
          delete next[item.key];
          return next;
        });
        return current.filter((key) => key !== item.key);
      }

      if (item.valido) {
        setPdfPeopleByKey((people) => ({
          ...people,
          [item.key]: people[item.key] ?? [createPdfPerson()],
        }));
      }
      return [...current, item.key];
    });
  }

  function addPdfPerson(itemKey: string) {
    setPdfPeopleByKey((current) => ({
      ...current,
      [itemKey]: [...(current[itemKey] ?? []), createPdfPerson()],
    }));
  }

  function removePdfPerson(itemKey: string, personId: string) {
    setPdfPeopleByKey((current) => {
      const currentPeople = current[itemKey] ?? [];
      const nextPeople = currentPeople.filter((person) => person.localId !== personId);
      if (!nextPeople.length) {
        setSelectedKeys((keys) => keys.filter((key) => key !== itemKey));
        const next = { ...current };
        delete next[itemKey];
        return next;
      }

      return {
        ...current,
        [itemKey]: nextPeople,
      };
    });
  }

  function updatePdfPerson(
    itemKey: string,
    personId: string,
    field: keyof Omit<PdfPerson, "localId">,
    value: string,
  ) {
    setPdfPeopleByKey((current) => ({
      ...current,
      [itemKey]: (current[itemKey] ?? [createPdfPerson()]).map((person) =>
        person.localId === personId ? { ...person, [field]: value } : person,
      ),
    }));
  }

  async function exportSelected() {
    setExportError(null);
    setIsExporting(true);
    try {
      const selectedItems = historico.filter(
        (item) => selectedSet.has(item.key) && item.valido,
      );
      const entries = selectedItems.flatMap((item) =>
        (pdfPeopleByKey[item.key] ?? []).map((person) => ({
          ids: item.ids,
          nome: person.nome.trim(),
          matricula: person.matricula.trim(),
          dataAlteracao: person.dataAlteracao,
        })),
      );

      if (
        entries.length === 0 ||
        entries.some((entry) => !entry.nome || !entry.dataAlteracao)
      ) {
        throw new Error("Informe nome e data de alteração para gerar o PDF.");
      }

      await downloadPdf(entries);
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
      const payload = values.interjornadaAtiva
        ? {
            modo: "interjornada",
            horarios: horariosFormatados,
            horarios2: formatarHorariosEntrada(
              values.segundaJornadaHorarios ?? "",
            ),
            validarInterjornada: true,
          }
        : isValidPrincipalEightHours(horariosFormatados)
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
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
      setSelectedKeys([]);
      setPdfPeopleByKey({});
    },
  });
  const clearHistoryMutation = useMutation({
    mutationFn: clearOwnHistory,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: historyQueryKey });
      const previousHistory =
        queryClient.getQueryData<HistoryRecord[]>(historyQueryKey);

      queryClient.setQueryData<HistoryRecord[]>(historyQueryKey, []);
      setSelectedKeys([]);
      setPdfPeopleByKey({});
      setHistoryPage(1);

      return { previousHistory };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(historyQueryKey, context.previousHistory);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
  });
  const selectedDeleteMutation = useMutation({
    mutationFn: deleteSelectedHistory,
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: historyQueryKey });
      const previousHistory =
        queryClient.getQueryData<HistoryRecord[]>(historyQueryKey);
      const idSet = new Set(ids);
      const keysToRemove = new Set(
        historico
          .filter((item) => item.ids.some((id) => idSet.has(id)))
          .map((item) => item.key),
      );

      queryClient.setQueryData<HistoryRecord[]>(historyQueryKey, (current) =>
        (current ?? []).filter((record) => !idSet.has(record.id)),
      );
      setSelectedKeys((current) =>
        current.filter((key) => !keysToRemove.has(key)),
      );
      setPdfPeopleByKey((current) => {
        const next = { ...current };
        keysToRemove.forEach((key) => {
          delete next[key];
        });
        return next;
      });

      return { previousHistory };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(historyQueryKey, context.previousHistory);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
  });

  const horariosField = form.register("horarios");
  const segundaJornadaField = form.register("segundaJornadaHorarios");
  const sabadoField = form.register("sabadoHorarios");

  return (
    <div className="jornada-studio">
      <section className="jornada-command">
        <div className="jornada-command__intro">
          <p className="jornada-command__kicker">Validador de jornada</p>
          <h1>Validar jornadas.</h1>
          <p>
            Digite a escala, confira o diagnóstico e selecione somente jornadas
            válidas para gerar a alteração.
          </p>
        </div>

        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="jornada-validator-panel"
        >
          <div className="jornada-panel-heading">
            <span className="jornada-panel-heading__icon">
              <Clock3 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2>
                {interjornadaAtiva
                  ? "Validar duas jornadas com interjornada"
                  : "Horários de segunda a sexta"}
              </h2>
              <p>
                {interjornadaAtiva
                  ? "Informe a primeira e a segunda jornada para conferir o descanso mínimo de 11 horas."
                  : "Use 2 ou 4 marcações, com ou sem dois-pontos."}
              </p>
            </div>
          </div>

          <label className="jornada-toggle" title={INTERJORNADA_HELP_TEXT}>
            <input type="checkbox" {...form.register("interjornadaAtiva")} />
            <span>
              <strong>
                Ativar interjornada
                <span
                  className="jornada-help-icon"
                  aria-label={INTERJORNADA_HELP_TEXT}
                  title={INTERJORNADA_HELP_TEXT}
                >
                  <Info className="size-full" aria-hidden="true" />
                </span>
              </strong>
              <small>
                Abre dois campos de jornada e compara o descanso entre a saída
                final da primeira e a entrada da segunda.
              </small>
            </span>
          </label>

          <label className="jornada-field">
            <span>{interjornadaAtiva ? "Primeira jornada" : "Jornada principal"}</span>
            <input
              {...horariosField}
              onBlur={(event) => {
                horariosField.onBlur(event);
                formatField("horarios");
              }}
              className="jornada-time-input"
              placeholder="0800 1200 1300 1700"
            />
          </label>
          {form.formState.errors.horarios ? (
            <p className="jornada-field-error">
              {form.formState.errors.horarios.message}
            </p>
          ) : null}
          <p className="jornada-field-hint">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {duracaoPrincipal
              ? `Duração detectada: ${duracaoPrincipal.duracaoFormatada}`
              : "Digite 2 ou 4 horários separados por espaço"}
          </p>

          {interjornadaAtiva ? (
            <>
              <label className="jornada-field">
                <span>Segunda jornada</span>
                <input
                  {...segundaJornadaField}
                  onBlur={(event) => {
                    segundaJornadaField.onBlur(event);
                    formatField("segundaJornadaHorarios");
                  }}
                  className="jornada-time-input"
                  placeholder="0800 1200 1300 1700"
                />
              </label>
              {form.formState.errors.segundaJornadaHorarios ? (
                <p className="jornada-field-error">
                  {form.formState.errors.segundaJornadaHorarios.message}
                </p>
              ) : null}
              <p className="jornada-field-hint">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {duracaoSegundaJornada
                  ? `Duração detectada: ${duracaoSegundaJornada.duracaoFormatada}`
                  : "Digite a jornada seguinte para calcular a interjornada"}
              </p>
            </>
          ) : null}

          {canShowSabado ? (
            <>
              <label className="jornada-field">
                <span>Complemento de sábado</span>
                <input
                  {...sabadoField}
                  onBlur={(event) => {
                    sabadoField.onBlur(event);
                    formatField("sabadoHorarios");
                  }}
                  className="jornada-time-input"
                  placeholder="0800 1200"
                />
              </label>
              {form.formState.errors.sabadoHorarios ? (
                <p className="jornada-field-error">
                  {form.formState.errors.sabadoHorarios.message}
                </p>
              ) : (
                <p className="jornada-field-success">
                  A jornada principal está apta; informe 04:00 no sábado para
                  completar 44h semanais quando a regra ou exceção permitir.
                </p>
              )}
            </>
          ) : null}

          <label className="jornada-toggle">
            <input
              type="checkbox"
              {...form.register("autoFormatar")}
            />
            <span>
              <strong>Auto-formatar horários</strong>
              <small>Exemplo: 0800 vira 08:00 ao sair do campo.</small>
            </span>
          </label>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="jornada-primary-button"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            {mutation.isPending ? "Validando..." : "Validar"}
          </button>
        </form>

        <section className="jornada-result-panel">
          <div className="jornada-result-panel__header">
            <div>
              <p className="jornada-command__kicker">Resultado</p>
              <h2>Diagnóstico da validação</h2>
            </div>
            <span
              className={
                mutation.data
                  ? mutation.data.valido
                    ? "jornada-status jornada-status--valid"
                    : "jornada-status jornada-status--invalid"
                  : "jornada-status"
              }
            >
              {mutation.data
                ? mutation.data.valido
                  ? "Válida"
                  : "Com ajuste"
                : "Aguardando"}
            </span>
          </div>
          {mutation.isError ? (
            <div className="jornada-alert jornada-alert--danger">
              {mutation.error.message}
            </div>
          ) : null}
          {mutation.data ? (
            isCombinedResponse(mutation.data) ? (
              <div className="jornada-result-stack">
                <ResultCard
                  title="Resumo"
                  result={{
                    valido: mutation.data.valido,
                    mensagem: mutation.data.mensagemInterjornada,
                    duracaoCalculada: sumDurations(
                      mutation.data.jornada1.duracaoCalculada,
                      mutation.data.jornada2.duracaoCalculada,
                    ),
                    codigo: joinCodigos(
                      mutation.data.jornada1.codigo,
                      mutation.data.jornada2.codigo,
                    ),
                    horasSemanais: getCombinedWeeklyHours(mutation.data),
                    horasMensais: getCombinedMonthlyHours(mutation.data),
                    intervalo:
                      mutation.data.interjornadaMinutos == null
                        ? undefined
                        : `${Math.floor(mutation.data.interjornadaMinutos / 60)}h${String(
                            mutation.data.interjornadaMinutos % 60,
                          ).padStart(2, "0")}`,
                  }}
                  intervalLabel="Interjornada"
                />
                <ResultCard
                  title={
                    mutation.data.modo === "interjornada"
                      ? "Primeira jornada"
                      : "Segunda a sexta"
                  }
                  result={mutation.data.jornada1}
                />
                <ResultCard
                  title={
                    mutation.data.modo === "interjornada"
                      ? "Segunda jornada"
                      : "Sábado"
                  }
                  result={mutation.data.jornada2}
                />
              </div>
            ) : (
              <div className="jornada-result-stack">
                <ResultCard title="Segunda a sexta" result={mutation.data} />
              </div>
            )
          ) : (
            <div className="jornada-result-empty">
              <CheckCircle2 className="size-8" aria-hidden="true" />
              <div>
                <strong>Resultado em destaque</strong>
                <p>
                  Depois de validar, este painel mostra duração, código,
                  intervalo e motivo do erro quando houver.
                </p>
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="jornada-history-panel">
        <div className="jornada-history-panel__header">
          <div>
            <div className="jornada-history-title">
              <History className="size-4" aria-hidden="true" />
              <h2>Últimas validações</h2>
            </div>
            <p>
              Página com 10 registros. Selecione somente jornadas válidas para
              montar o PDF.
            </p>
          </div>
          <div className="jornada-history-summary">
            <span>{totalValidCount} válidas</span>
            <button
              type="button"
              onClick={() => {
                setHideInvalidHistory((value) => !value);
                setHistoryPage(1);
              }}
              aria-pressed={hideInvalidHistory}
              title={
                hideInvalidHistory
                  ? "Mostrar jornadas com erro"
                  : "Ocultar jornadas com erro"
              }
            >
              {hideInvalidHistory ? "Erros ocultos" : `${totalErrorCount} com erro`}
            </button>
          </div>
          <button
            type="button"
            onClick={exportSelected}
            title={
              selectedItemCount === 0
                ? "Selecione ao menos uma jornada válida para gerar o PDF."
                : selectedValidCount === 0
                ? "As jornadas selecionadas têm erro e não podem gerar PDF."
                : "Gerar PDF somente com as jornadas válidas selecionadas."
            }
            disabled={
              selectedValidCount === 0 ||
              isExporting ||
              selectedDeleteMutation.isPending
            }
            className="jornada-secondary-button"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            Gerar PDF
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedHistoryIds.length > 0) {
                if (
                  window.confirm(
                    selectedHistoryIds.length === 1
                      ? "Excluir 1 validação selecionada? Esta ação não pode ser desfeita."
                      : `Excluir ${selectedHistoryIds.length} validações selecionadas? Esta ação não pode ser desfeita.`,
                  )
                ) {
                  selectedDeleteMutation.mutate(selectedHistoryIds);
                }
                return;
              }

              if (
                window.confirm(
                  "Limpar todo o seu histórico de validações? Esta ação não pode ser desfeita.",
                )
              ) {
                clearHistoryMutation.mutate();
              }
            }}
            disabled={
              (historico.length === 0 && selectedHistoryIds.length === 0) ||
              clearHistoryMutation.isPending ||
              selectedDeleteMutation.isPending ||
              mutation.isPending ||
              isExporting
            }
            className="jornada-danger-button"
          >
            {clearHistoryMutation.isPending || selectedDeleteMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            {selectedHistoryIds.length > 0
              ? "Excluir selecionados"
              : "Limpar meu histórico"}
          </button>
        </div>
        {exportError ? (
          <div className="jornada-alert jornada-alert--danger">
            {exportError}
          </div>
        ) : null}
        {selectedItemCount > 0 && selectedValidCount === 0 ? (
          <div className="jornada-alert jornada-alert--danger">
            As validações selecionadas têm erro. Elas podem ser excluídas pelo
            botão Excluir selecionados, mas não geram PDF. Para gerar o PDF,
            desmarque os erros e selecione uma jornada válida.
          </div>
        ) : null}
        {selectionMode === "valid" ? (
          <div className="jornada-alert jornada-alert--success">
            Seleção em modo válido: somente outras jornadas válidas podem ser
            adicionadas até a seleção atual ser limpa.
          </div>
        ) : null}
        {selectionMode === "invalid" && selectedErrorCount > 0 ? (
          <div className="jornada-alert jornada-alert--danger">
            Seleção em modo erro: somente outras jornadas com erro podem ser
            adicionadas até a seleção atual ser limpa.
          </div>
        ) : null}
        {clearHistoryMutation.isError ? (
          <div className="jornada-alert jornada-alert--danger">
            {clearHistoryMutation.error.message}
          </div>
        ) : null}
        {selectedDeleteMutation.isError ? (
          <div className="jornada-alert jornada-alert--danger">
            {selectedDeleteMutation.error.message}
          </div>
        ) : null}
        {clearHistoryMutation.isSuccess ? (
          <div className="jornada-alert jornada-alert--success">
            Histórico limpo. Registros removidos:{" "}
            {clearHistoryMutation.data.deletedCount}.
          </div>
        ) : null}
        {selectedDeleteMutation.isSuccess ? (
          <div className="jornada-alert jornada-alert--success">
            Registros selecionados removidos:{" "}
            {selectedDeleteMutation.data.deletedCount}.
          </div>
        ) : null}
        {selectedValidCount > 0 ? (
          <div className="jornada-pdf-editor">
            <div>
              <h3>
                Dados para Alteração de Jornada
              </h3>
              <p>
                Adicione uma ou mais pessoas para cada horário selecionado.
              </p>
            </div>
            {historico
              .filter((item) => selectedSet.has(item.key) && item.valido)
              .map((item) => (
                <div
                  key={item.key}
                  className="jornada-pdf-editor__card"
                >
                  <div className="jornada-pdf-editor__card-head">
                    <div>
                      <p>
                        {item.horarios}
                      </p>
                      <small>
                        Código: {item.codigo ?? "-"}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => addPdfPerson(item.key)}
                      className="jornada-ghost-button"
                    >
                      Adicionar pessoa
                    </button>
                  </div>
                  <div className="jornada-pdf-people">
                    {(pdfPeopleByKey[item.key] ?? [createPdfPerson()]).map(
                      (person, index) => (
                        <div
                          key={person.localId}
                          className="jornada-pdf-person"
                        >
                          <label>
                            Nome
                            <input
                              value={person.nome}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "nome",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                              placeholder={`Pessoa ${index + 1}`}
                            />
                          </label>
                          <label>
                            Matrícula (opcional)
                            <input
                              value={person.matricula}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "matricula",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                              placeholder="Matrícula"
                            />
                          </label>
                          <label>
                            Data de alteração
                            <input
                              type="date"
                              value={person.dataAlteracao}
                              onChange={(event) =>
                                updatePdfPerson(
                                  item.key,
                                  person.localId,
                                  "dataAlteracao",
                                  event.target.value,
                                )
                              }
                              className="jornada-compact-input"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removePdfPerson(item.key, person.localId)}
                            className="jornada-ghost-button self-end"
                          >
                            Remover
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : null}
        {historicoQuery.isLoading ? (
          <p className="jornada-history-empty">Carregando histórico...</p>
        ) : filteredHistorico.length > 0 ? (
          <div className="jornada-history-list">
            <label className="jornada-history-select-all">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                disabled={selectableVisibleHistorico.length === 0}
              />
              {selectionMode === "valid"
                ? "Selecionar válidas exibidas"
                : selectionMode === "invalid"
                ? "Selecionar erros exibidos"
                : bulkSelectionMode === "valid"
                ? "Selecionar válidas exibidas"
                : bulkSelectionMode === "invalid"
                ? "Selecionar erros exibidos"
                : "Selecione um item para definir o tipo"}
            </label>
            {visibleHistorico.map((item) => {
              const Icon = item.valido ? CheckCircle2 : AlertTriangle;
              const primaryMessage = getPrimaryMessage(item.mensagem);
              const secondaryMessages = getSecondaryMessages(item.mensagem);
              const blockedBySelection =
                (selectionMode === "valid" && !item.valido) ||
                (selectionMode === "invalid" && item.valido);
              return (
                <div
                  key={item.key}
                  className="jornada-history-item"
                  data-valid={item.valido}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.key)}
                    onChange={() => toggleOne(item)}
                    disabled={blockedBySelection && !selectedSet.has(item.key)}
                    title={
                      blockedBySelection && !selectedSet.has(item.key)
                        ? "Desmarque a seleção atual para alternar entre jornadas válidas e jornadas com erro."
                        : undefined
                    }
                    aria-label={`Selecionar jornada ${item.horarios}`}
                  />
                  <span className="jornada-history-item__body">
                    <span className="jornada-history-item__meta">
                      <span>{formatDate(item.createdAt)}</span>
                      <strong>{item.horarios}</strong>
                    </span>
                    <span className="jornada-history-item__message">
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{primaryMessage}</span>
                    </span>
                    {secondaryMessages.length > 0 ? (
                      <details className="jornada-history-details">
                        <summary>Ver detalhes do diagnóstico</summary>
                        <ul>
                          {secondaryMessages.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {!item.valido ? (
                      <span className="jornada-history-item__note">
                        Jornadas com erro podem ser excluídas em seleção separada,
                        mas não entram no PDF.
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {historyPageCount > 1 ? (
              <div className="jornada-history-pagination">
                <span>
                  Página {historyPage} de {historyPageCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    disabled={historyPage === 1}
                    className="jornada-ghost-button"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setHistoryPage((page) => Math.min(historyPageCount, page + 1))
                    }
                    disabled={historyPage === historyPageCount}
                    className="jornada-ghost-button"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="jornada-history-empty">
            {hideInvalidHistory
              ? "Nenhuma validação válida nesta visualização."
              : "Nenhuma validação registrada ainda."}
          </p>
        )}
      </section>
    </div>
  );
}
