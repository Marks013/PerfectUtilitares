"use client";
import {
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { z } from "zod";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
} from "@/lib/jornada/input-format";
import { validarJornadaManual } from "@/lib/jornada/validator";
export const AUTO_FORMAT_KEY = "jornada:auto-formatar:v2";
export const HISTORY_PAGE_SIZE = 10;
export const INTERJORNADA_HELP_TEXT =
  "O intervalo interjornada é o período mínimo de descanso de 11 horas entre o fim de uma jornada de trabalho e o início da seguinte, garantindo saúde, segurança e bem-estar do trabalhador.";

export function getAutoFormatStorageKey(userId: string) {
  return `${AUTO_FORMAT_KEY}:${userId}`;
}

export const schema = z
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
    }
  });

export type FormValues = z.infer<typeof schema>;

export type JornadaResult = {
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

export type CombinedResponse = {
  modo: "interjornada" | "sabado-combinado";
  valido: boolean;
  jornada1: JornadaResult;
  jornada2: JornadaResult;
  mensagemInterjornada: string;
  interjornadaMinutos?: number;
  ids?: string[];
};

export type ValidationResponse = SimpleResponse | CombinedResponse;

type AuthorizedJornadaException = {
  id: string;
  horariosNormalizado: string;
  sabadoNormalizado: string | null;
  active: boolean;
};

export type HistoryRecord = JornadaResult & {
  id: string;
  horariosOriginal: string;
  horariosNormalizado: string;
  tipoDia: "util" | "sabado" | "domingo" | "feriado";
  createdAt: string;
  user?: { name?: string | null; email?: string | null } | null;
};

type BatchLine = {
  numeroLinha: number;
  matricula: string;
  nome: string;
  cargo: string;
  horariosOriginais: string;
  jornadaCompleta: string;
  resultado?: JornadaResult & {
    tipoDia?: string;
    horasSemanais: number;
    horasMensais: number;
  };
};

type BatchReport = {
  arquivoOrigem: string;
  nomePlanilha: string;
  totalLinhas: number;
  validos: number;
  erros: number;
  avisos: number;
  linhas: BatchLine[];
  linhasComErro: BatchLine[];
  jornadasRepetidas: Record<string, number>;
};

export const historyQueryKey = ["jornada", "historico"] as const;

export type HistoryItem = {
  key: string;
  ids: string[];
  createdAt: string;
  horarios: string;
  valido: boolean;
  mensagem: string;
  codigo?: string;
};

export type PdfPerson = {
  localId: string;
  nome: string;
  matricula: string;
  dataAlteracao: string;
};

export type PdfExportEntry = {
  ids: string[];
  nome: string;
  matricula: string;
  dataAlteracao: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

export async function getErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? "Falha ao validar jornada";
  } catch {
    return "Falha ao validar jornada";
  }
}

export function isCombinedResponse(value: ValidationResponse): value is CombinedResponse {
  return "jornada1" in value && "jornada2" in value;
}

export function joinCodigos(...codigos: Array<string | undefined>) {
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

export function sumDurations(...values: Array<string | undefined>) {
  const minutes = values.map(parseDurationMinutes);
  if (minutes.some((value) => value == null)) return undefined;

  return formatDurationMinutes(
    minutes.reduce<number>((total, value) => total + (value ?? 0), 0),
  );
}

export function getCombinedWeeklyHours(result: CombinedResponse) {
  return result.modo === "sabado-combinado"
    ? result.jornada2.horasSemanais
    : undefined;
}

export function getCombinedMonthlyHours(result: CombinedResponse) {
  return result.modo === "sabado-combinado"
    ? result.jornada2.horasMensais
    : undefined;
}

export function formatDate(value: string) {
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

export function getPrimaryMessage(value: string) {
  return splitMessage(value)[0] ?? value;
}

export function getSecondaryMessages(value: string) {
  return splitMessage(value).slice(1);
}

export function isValidPrincipalEightHours(value: string) {
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

export function groupHistory(records: HistoryRecord[]): HistoryItem[] {
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

export function ResultCard({
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

export async function fetchHistory() {
  const response = await fetch("/api/jornada/historico");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return (await response.json()) as HistoryRecord[];
}

export async function fetchOwnJornadaExceptions() {
  const response = await fetch("/api/jornada/excecoes?scope=mine");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return (await response.json()) as AuthorizedJornadaException[];
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

export function createPdfPerson(): PdfPerson {
  return {
    localId: createLocalId(),
    nome: "",
    matricula: "",
    dataAlteracao: todayInputValue(),
  };
}

export async function downloadPdf(entries: PdfExportEntry[]) {
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

export async function clearOwnHistory() {
  const response = await fetch("/api/jornada/historico?scope=mine", {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as { deletedCount: number };
}

export async function deleteSelectedHistory(ids: string[]) {
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

export async function validateBatchSpreadsheet({
  file,
  validarPeriodos,
  validarJornada,
  validarIntervalos,
  usarHorariosAgrupados,
}: {
  file: File;
  validarPeriodos: boolean;
  validarJornada: boolean;
  validarIntervalos: boolean;
  usarHorariosAgrupados: boolean;
}) {
  const formData = createBatchFormData({
    file,
    validarPeriodos,
    validarJornada,
    validarIntervalos,
    usarHorariosAgrupados,
  });

  const response = await fetch("/api/jornada/validar-lote", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as BatchReport;
}

function createBatchFormData({
  file,
  validarPeriodos,
  validarJornada,
  validarIntervalos,
  usarHorariosAgrupados,
}: {
  file: File;
  validarPeriodos: boolean;
  validarJornada: boolean;
  validarIntervalos: boolean;
  usarHorariosAgrupados: boolean;
}) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("validarPeriodos", String(validarPeriodos));
  formData.set("validarJornada", String(validarJornada));
  formData.set("validarIntervalos", String(validarIntervalos));
  formData.set("usarHorariosAgrupados", String(usarHorariosAgrupados));
  return formData;
}

export async function downloadBatchReportPdf({
  file,
  validarPeriodos,
  validarJornada,
  validarIntervalos,
  usarHorariosAgrupados,
  pdfDetalhado = false,
}: {
  file: File;
  validarPeriodos: boolean;
  validarJornada: boolean;
  validarIntervalos: boolean;
  usarHorariosAgrupados: boolean;
  pdfDetalhado?: boolean;
}) {
  const formData = createBatchFormData({
    file,
    validarPeriodos,
    validarJornada,
    validarIntervalos,
    usarHorariosAgrupados,
  });
  formData.set("formato", "pdf");
  formData.set("pdfDetalhado", String(pdfDetalhado));

  const response = await fetch("/api/jornada/validar-lote", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "relatorio-validacao-jornada.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
