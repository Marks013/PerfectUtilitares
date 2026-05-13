import JSZip from "jszip";
import { normalizarHorarios } from "@/lib/codigos/horario-normalizer";
import { JORNADA_CONFIG } from "./default-rules";
import {
  calcularDuracaoMinutos,
  formatarDuracao,
  parseHorario,
  validarLimiteDiario,
} from "./time";
import type { JornadaRuleInput } from "./types";

export type JornadaBatchConfig = {
  validarPeriodos: boolean;
  validarJornada: boolean;
  validarIntervalos: boolean;
  usarHorariosAgrupados: boolean;
  linhaInicio: number;
  colunaHorariosAgrupados: number;
};

export type JornadaBatchLine = {
  numeroLinha: number;
  matricula: string;
  nome: string;
  cargo: string;
  horarios: string[];
  horariosOriginais: string;
  jornadaCompleta: string;
  linhaSabado?: boolean;
  jornadaReferenciaMinutos?: number | null;
  resultado?: JornadaBatchValidationResult;
};

export type JornadaBatchValidationResult = {
  valido: boolean;
  mensagem: string;
  duracaoCalculada: string;
  tipoDia: string;
  codigo?: string;
  horasSemanais: number;
  horasMensais: number;
  intervalo?: string;
};

export type JornadaBatchReport = {
  arquivoOrigem: string;
  nomePlanilha: string;
  totalLinhas: number;
  validos: number;
  erros: number;
  avisos: number;
  linhas: JornadaBatchLine[];
  linhasComErro: JornadaBatchLine[];
  jornadasRepetidas: Record<string, number>;
};

type ParsedSheet = {
  name: string;
  rows: unknown[][];
};

export const DEFAULT_JORNADA_BATCH_CONFIG: JornadaBatchConfig = {
  validarPeriodos: true,
  validarJornada: true,
  validarIntervalos: true,
  usarHorariosAgrupados: false,
  linhaInicio: 3,
  colunaHorariosAgrupados: 2,
};

const TIME_TEXT_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/;
const TEXT_HOUR_PATTERN = /\b(\d{1,2}):?(\d{2})\b/g;
const COMPACT_HOUR_PATTERN = /\b(\d{3,4})\b/g;
const INDIVIDUAL_HOUR_COLUMNS = [8, 10, 11, 13];
const XLSX_TIME_ROUNDING_TOLERANCE_SECONDS = 1;
export const NON_SUBORDINATE_SCHEDULE_LABEL = "NÃO SUBORNIDADO Á HORÁRIO";

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getAttribute(value: string, name: string) {
  return new RegExp(`${name}="([^"]*)"`).exec(value)?.[1] ?? null;
}

function columnIndexFromReference(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0] ?? "";
  return letters
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function findZipEntry(zip: JSZip, candidates: string[]) {
  const names = Object.keys(zip.files);
  return candidates.find((candidate) => names.includes(candidate));
}

function extractTextNodes(xml: string) {
  const values: string[] = [];
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;

  while ((match = textPattern.exec(xml))) {
    values.push(decodeXml(match[1] ?? ""));
  }

  return values.join("");
}

function parseSharedStrings(xml: string | null) {
  if (!xml) return [];

  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml))) {
    strings.push(extractTextNodes(match[1] ?? ""));
  }

  return strings;
}

function parseCellValue(
  attributes: string,
  innerXml: string,
  sharedStrings: string[],
) {
  const type = getAttribute(attributes, "t");

  if (type === "inlineStr") {
    return extractTextNodes(innerXml).trim();
  }

  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(innerXml)?.[1];
  if (value == null) return "";

  const decoded = decodeXml(value).trim();
  if (type === "s") {
    return sharedStrings[Number(decoded)] ?? "";
  }

  const numeric = Number(decoded);
  return Number.isFinite(numeric) ? numeric : decoded;
}

function parseSheetXml(xml: string, sharedStrings: string[]): unknown[][] {
  const rows: unknown[][] = [];
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(xml))) {
    const rowNumber = Number(getAttribute(rowMatch[1] ?? "", "r"));
    const rowIndex = Number.isFinite(rowNumber) && rowNumber > 0
      ? rowNumber - 1
      : rows.length;
    const row: unknown[] = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellPattern.exec(rowMatch[2] ?? ""))) {
      const reference = getAttribute(cellMatch[1] ?? "", "r");
      const columnIndex = reference ? columnIndexFromReference(reference) : row.length;
      if (columnIndex >= 0) {
        row[columnIndex] = parseCellValue(
          cellMatch[1] ?? "",
          cellMatch[2] ?? "",
          sharedStrings,
        );
      }
    }

    rows[rowIndex] = row;
  }

  return rows;
}

export async function parseJornadaBatchXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetEntry = findZipEntry(zip, [
    "xl/worksheets/sheet1.xml",
    "xl\\worksheets\\sheet1.xml",
    "xl/sheet1.xml",
    "xl\\sheet1.xml",
  ]);

  if (!sheetEntry) {
    throw new Error("A primeira planilha não foi encontrada no arquivo .xlsx.");
  }

  const sharedStringsEntry = findZipEntry(zip, [
    "xl/sharedStrings.xml",
    "xl\\sharedStrings.xml",
  ]);
  const sharedStringsXml = sharedStringsEntry
    ? await zip.file(sharedStringsEntry)?.async("string")
    : null;
  const sharedStrings = parseSharedStrings(sharedStringsXml ?? null);
  const sheetXml = await zip.file(sheetEntry)?.async("string");

  if (!sheetXml) {
    throw new Error("Não foi possível ler a primeira planilha do arquivo .xlsx.");
  }

  return {
    name: "Planilha1",
    rows: parseSheetXml(sheetXml, sharedStrings),
  };
}

function formatMinuteOfDay(totalMinutes: number) {
  const nearestMinute = Math.round(totalMinutes);
  const distanceSeconds = Math.abs(totalMinutes - nearestMinute) * 60;
  let minute =
    distanceSeconds <= XLSX_TIME_ROUNDING_TOLERANCE_SECONDS
      ? nearestMinute
      : Math.floor(totalMinutes);

  if (minute >= 1440) minute = 1439;
  if (minute < 0) minute = 0;

  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

function normalizeTimeText(value: string) {
  const match = TIME_TEXT_PATTERN.exec(value.trim());
  if (!match) return "";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds > 59) {
    return "";
  }

  return formatMinuteOfDay(hours * 60 + minutes + (seconds + fraction) / 60);
}

export function normalizarHorarioLote(value: unknown): string {
  if (value == null) return "";

  if (value instanceof Date) {
    return formatMinuteOfDay(
      value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60,
    );
  }

  if (typeof value === "number") {
    if (value > 0 && value < 1) return formatMinuteOfDay(value * 1440);
    if (value >= 0 && value <= 23 && Number.isInteger(value)) {
      return `${String(value).padStart(2, "0")}:00`;
    }
  }

  const raw = String(value).trim();
  if (!raw) return "";

  if (raw.includes(":")) {
    return normalizeTimeText(raw);
  }

  const numeric = Number(raw.replace(",", "."));
  if (Number.isFinite(numeric)) {
    if (numeric > 0 && numeric < 1) return formatMinuteOfDay(numeric * 1440);
    if (numeric >= 0 && numeric <= 23 && Number.isInteger(numeric)) {
      return `${String(numeric).padStart(2, "0")}:00`;
    }
  }

  if (/^\d{3,4}$/.test(raw)) {
    const compact = raw.padStart(4, "0");
    const hours = Number(compact.slice(0, 2));
    const minutes = Number(compact.slice(2));
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }

  return "";
}

function getCellText(row: unknown[], index: number) {
  if (index < 0 || index >= row.length) return "";
  const value = row[index];
  return value == null ? "" : String(value).trim();
}

function cleanHorarioText(value: string) {
  return value
    .replaceAll("às", " ")
    .replaceAll("Às", " ")
    .replaceAll("as", " ")
    .replaceAll("e", " ")
    .replaceAll(",", " ")
    .replaceAll(";", " ")
    .replaceAll("-", " ")
    .replaceAll("h", ":")
    .replaceAll("H", ":")
    .replace(/\s+/g, " ")
    .trim();
}

export function extrairHorariosDoTexto(value: string) {
  const horarios: string[] = [];
  const texto = cleanHorarioText(value);
  let match: RegExpExecArray | null;

  TEXT_HOUR_PATTERN.lastIndex = 0;
  while ((match = TEXT_HOUR_PATTERN.exec(texto))) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      horarios.push(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
    }
  }

  COMPACT_HOUR_PATTERN.lastIndex = 0;
  while ((match = COMPACT_HOUR_PATTERN.exec(texto))) {
    const compact = match[1].padStart(4, "0");
    const hours = Number(compact.slice(0, 2));
    const minutes = Number(compact.slice(2));
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      horarios.push(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
    }
  }

  return [...new Set(horarios)].sort();
}

function isHeaderText(value: string) {
  const upper = value.toUpperCase();
  return (
    upper.includes("NOME") ||
    upper.includes("FUNCIONARIO") ||
    upper.includes("FUNCIONÁRIO") ||
    upper.includes("CARGO") ||
    upper.includes("HORARIO") ||
    upper.includes("HORÁRIO") ||
    upper.includes("MATRICULA") ||
    upper.includes("MATRÍCULA") ||
    upper.includes("CODIGO") ||
    upper.includes("CÓDIGO") ||
    upper.includes("QUADRO")
  );
}

function isTitleRow(nome: string, cargo: string) {
  if (!nome.trim()) return false;

  const upper = nome.toUpperCase();
  if (
    upper.includes("SUPERMERCADOS") ||
    upper.includes("LTDA") ||
    upper.includes("S/A") ||
    upper.includes("S.A.") ||
    /\bME\b/.test(upper) ||
    upper.includes("EIRELI") ||
    upper.includes("PLANALTO") ||
    upper.includes("PLANEJAMENTO") ||
    upper.includes("DEPARTAMENTO") ||
    upper.includes("SETOR") ||
    upper.includes("SEÇÃO") ||
    upper.includes("DIVISÃO")
  ) {
    return true;
  }

  return !cargo.trim() && nome.length > 40;
}

function readIndividualHours(row: unknown[]) {
  const horarios = INDIVIDUAL_HOUR_COLUMNS.map((column) =>
    normalizarHorarioLote(row[column]),
  );

  if (
    horarios.length === INDIVIDUAL_HOUR_COLUMNS.length &&
    horarios.every((horario) => horario === "00:00")
  ) {
    return horarios;
  }

  return horarios.filter((horario) => horario && horario !== "00:00");
}

function readGroupedHours(row: unknown[], config: JornadaBatchConfig) {
  const text = getCellText(row, config.colunaHorariosAgrupados - 1);
  return {
    text,
    horarios: text ? extrairHorariosDoTexto(text) : [],
  };
}

function isSaturdayRow(row: unknown[]) {
  const marker = getCellText(row, 7);
  return /s[áa]bado/i.test(marker);
}

function calculateScheduleDuration(horarios: string[]) {
  const validHours = horarios.filter((item) => item && item !== "00:00");
  const parsed = validHours.map(parseHorario);
  if (parsed.some((value) => value == null)) return null;

  const times = parsed as number[];
  if (times.length === 2 && times[0] < times[1]) {
    return calcularDuracaoMinutos(times[0], times[1]);
  }

  if (
    times.length === 4 &&
    times[0] < times[1] &&
    times[1] <= times[2] &&
    times[2] < times[3]
  ) {
    return (
      calcularDuracaoMinutos(times[0], times[1]) +
      calcularDuracaoMinutos(times[2], times[3])
    );
  }

  return null;
}

export function lerLinhasParaValidacao(
  rows: unknown[][],
  config: JornadaBatchConfig,
): JornadaBatchLine[] {
  const linhas: JornadaBatchLine[] = [];
  let lastMatricula = "";
  let lastNome = "";
  let lastCargo = "";
  let lastDuration: number | null = null;

  rows.forEach((row, index) => {
    const numeroLinha = index + 1;
    if (numeroLinha < config.linhaInicio) return;

    const grouped = config.usarHorariosAgrupados
      ? readGroupedHours(row, config)
      : null;
    const horarios = grouped ? grouped.horarios : readIndividualHours(row);
    if (horarios.length === 0) return;

    const linha: JornadaBatchLine = {
      numeroLinha,
      matricula: getCellText(row, 0),
      nome: config.usarHorariosAgrupados ? "" : getCellText(row, 2),
      cargo: config.usarHorariosAgrupados ? "" : getCellText(row, 4),
      horarios,
      horariosOriginais: grouped ? grouped.text : horarios.join(" "),
      jornadaCompleta: horarios.join(" - "),
    };

    if (!config.usarHorariosAgrupados) {
      const hasRegularName =
        Boolean(linha.nome) &&
        !isHeaderText(linha.nome) &&
        !isTitleRow(linha.nome, linha.cargo);

      if (hasRegularName) {
        lastMatricula = linha.matricula;
        lastNome = linha.nome;
        lastCargo = linha.cargo;
        lastDuration = calculateScheduleDuration(linha.horarios);
      }

      if (!linha.nome && isSaturdayRow(row)) {
        linha.linhaSabado = true;
        linha.matricula = lastMatricula;
        linha.nome = lastNome;
        linha.cargo = lastCargo ? `${lastCargo} - Sábado` : "Sábado";
        linha.jornadaReferenciaMinutos = lastDuration;
      }
    }

    if (config.usarHorariosAgrupados) {
      if (!linha.matricula || isHeaderText(linha.matricula)) return;
    } else {
      if (!linha.nome || isHeaderText(linha.nome)) return;
      if (isTitleRow(linha.nome, linha.cargo)) return;
    }

    linhas.push(linha);
  });

  return linhas;
}

function createError(message: string): JornadaBatchValidationResult {
  return {
    valido: false,
    mensagem: message,
    duracaoCalculada: "00:00",
    tipoDia: "",
    horasSemanais: 0,
    horasMensais: 0,
  };
}

function createNonSubordinateSchedule(): JornadaBatchValidationResult {
  return {
    valido: true,
    mensagem: NON_SUBORDINATE_SCHEDULE_LABEL,
    duracaoCalculada: "00:00",
    tipoDia: NON_SUBORDINATE_SCHEDULE_LABEL,
    horasSemanais: 0,
    horasMensais: 0,
  };
}

function determineDayType(durationMinutes: number) {
  switch (durationMinutes) {
    case 240:
    case 350:
    case 440:
      return "Segunda a Sábado";
    case 480:
      return "Segunda a Sexta";
    default:
      return "Não especificado";
  }
}

function createSuccess(
  rule: JornadaRuleInput | undefined,
  durationMinutes: number,
  intervalMinutes: number | null,
  input: string,
  codigoByHorario: Map<string, string>,
): JornadaBatchValidationResult {
  const normalized = normalizarHorarios(input);
  const code = codigoByHorario.get(normalized);
  const message = rule
    ? `${rule.nome}${code ? ` (Código: ${code})` : ""}`
    : `Duração: ${formatarDuracao(durationMinutes)}${code ? ` (Código: ${code})` : ""}`;

  return {
    valido: true,
    mensagem: message,
    duracaoCalculada: formatarDuracao(durationMinutes),
    tipoDia: determineDayType(durationMinutes),
    codigo: code,
    horasSemanais: rule?.horasSemanais ?? 0,
    horasMensais: rule?.horasMensais ?? 0,
    intervalo:
      intervalMinutes == null ? undefined : formatarDuracao(intervalMinutes),
  };
}

function getRule(rules: JornadaRuleInput[], durationMinutes: number) {
  return rules.find(
    (rule) => rule.active !== false && rule.duracaoMinutos === durationMinutes,
  );
}

function getExpectedSaturdayDuration(referenceMinutes?: number | null) {
  if (referenceMinutes == null) return null;
  return referenceMinutes === 480
    ? JORNADA_CONFIG.complementoSabadoMinutos
    : referenceMinutes;
}

function validateSaturdayDuration(
  durationMinutes: number,
  referenceMinutes?: number | null,
) {
  const expected = getExpectedSaturdayDuration(referenceMinutes);
  if (expected == null || durationMinutes === expected) return null;

  return `Sábado deve ter jornada de ${formatarDuracao(
    expected,
  )} quando a jornada principal é ${formatarDuracao(
    referenceMinutes ?? 0,
  )}. Encontrado: ${formatarDuracao(durationMinutes)}`;
}

export function validarHorariosLote(
  horariosArray: string[],
  config: JornadaBatchConfig,
  rules: JornadaRuleInput[],
  codigoByHorario = new Map<string, string>(),
  context: { linhaSabado?: boolean; jornadaReferenciaMinutos?: number | null } = {},
): JornadaBatchValidationResult {
  if (
    horariosArray.length > 0 &&
    horariosArray.every((item) => item.trim() === "00:00")
  ) {
    return createNonSubordinateSchedule();
  }

  const horarios = horariosArray.filter((item) => item.trim() && item !== "00:00");
  if (horarios.length === 0) return createError("Nenhum horário válido");
  if (horarios.length !== 2 && horarios.length !== 4) {
    return createError(`Quantidade inválida de horários: ${horarios.length}`);
  }

  const parsed = horarios.map(parseHorario);
  if (parsed.some((value) => value == null)) return createError("Formato inválido");
  const times = parsed as number[];

  if (times.length === 2) {
    if (times[0] >= times[1]) return createError("Horário inicial ≥ final");

    const duration = calcularDuracaoMinutos(times[0], times[1]);
    if (context.linhaSabado) {
      const saturdayError = validateSaturdayDuration(
        duration,
        context.jornadaReferenciaMinutos,
      );
      if (saturdayError) return createError(saturdayError);
    }

    if (config.validarJornada) {
      if (!validarLimiteDiario(duration, JORNADA_CONFIG.periodoMaximoHoras)) {
        return createError(`Duração excede 10h: ${formatarDuracao(duration)}`);
      }

      const rule = getRule(rules, duration);
      if (!rule) return createError(`Duração não válida: ${formatarDuracao(duration)}`);
      if (rule.intervaloMin > 0) return createError("Jornada requer intervalo (4 horários)");
      return createSuccess(rule, duration, null, horarios.join(" "), codigoByHorario);
    }

    return createSuccess(
      getRule(rules, duration),
      duration,
      null,
      horarios.join(" "),
      codigoByHorario,
    );
  }

  const [start1, end1, start2, end2] = times;
  if (start1 >= end1 || end1 > start2 || start2 >= end2) {
    return createError("Horários fora de ordem");
  }

  const duration1 = calcularDuracaoMinutos(start1, end1);
  const interval = calcularDuracaoMinutos(end1, start2);
  const duration2 = calcularDuracaoMinutos(start2, end2);
  const totalDuration = duration1 + duration2;
  const errors: string[] = [];
  if (context.linhaSabado) {
    const saturdayError = validateSaturdayDuration(
      totalDuration,
      context.jornadaReferenciaMinutos,
    );
    if (saturdayError) errors.push(saturdayError);
  }

  if (config.validarPeriodos) {
    if (duration1 > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      errors.push(
        `1º período > ${formatarDuracao(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}: ${formatarDuracao(duration1)}`,
      );
    }

    if (duration2 > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      errors.push(
        `2º período > ${formatarDuracao(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}: ${formatarDuracao(duration2)}`,
      );
    }

    const totalPeriodHours = (totalDuration + interval) / 60;
    if (totalPeriodHours > JORNADA_CONFIG.periodoMaximoHoras) {
      errors.push(
        `Período total > ${JORNADA_CONFIG.periodoMaximoHoras.toFixed(
          1,
        )}h: ${totalPeriodHours.toFixed(1)}h`,
      );
    }
  }

  const rule = getRule(rules, totalDuration);
  if (config.validarJornada && !rule) {
    errors.push(`Duração não válida: ${formatarDuracao(totalDuration)}`);
  }

  if (config.validarIntervalos && rule) {
    if (interval < rule.intervaloMin) {
      errors.push(
        `Intervalo < mínimo: ${formatarDuracao(interval)} (mín: ${formatarDuracao(
          rule.intervaloMin,
        )})`,
      );
    }

    if (rule.intervaloMax > 0 && interval > rule.intervaloMax) {
      errors.push(
        `Intervalo > máximo: ${formatarDuracao(interval)} (máx: ${formatarDuracao(
          rule.intervaloMax,
        )})`,
      );
    }
  }

  if (errors.length > 0) return createError(errors.join(" | "));
  return createSuccess(rule, totalDuration, interval, horarios.join(" "), codigoByHorario);
}

function errorDedupeKey(line: JornadaBatchLine) {
  return [
    line.matricula.trim().toUpperCase(),
    line.nome.trim().toUpperCase(),
    line.jornadaCompleta.trim(),
    line.resultado?.mensagem.trim() ?? "",
  ].join("|");
}

function dedupeErrorLines(lines: JornadaBatchLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = errorDedupeKey(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function validarJornadaBatchXlsx({
  buffer,
  fileName,
  config = DEFAULT_JORNADA_BATCH_CONFIG,
  rules,
  codigoByHorario = new Map<string, string>(),
}: {
  buffer: Buffer;
  fileName: string;
  config?: JornadaBatchConfig;
  rules: JornadaRuleInput[];
  codigoByHorario?: Map<string, string>;
}): Promise<JornadaBatchReport> {
  const sheet = await parseJornadaBatchXlsx(buffer);
  const linhas = lerLinhasParaValidacao(sheet.rows, config).map((line) => {
    const resultado = validarHorariosLote(
      line.horarios,
      config,
      rules,
      codigoByHorario,
      {
        linhaSabado: line.linhaSabado,
        jornadaReferenciaMinutos: line.jornadaReferenciaMinutos,
      },
    );
    const isNonSubordinate =
      line.horarios.length > 0 &&
      line.horarios.every((horario) => horario === "00:00");

    return {
      ...line,
      resultado,
      horariosOriginais: isNonSubordinate
        ? NON_SUBORDINATE_SCHEDULE_LABEL
        : line.horariosOriginais,
      jornadaCompleta: isNonSubordinate
        ? NON_SUBORDINATE_SCHEDULE_LABEL
        : line.jornadaCompleta,
    };
  });
  const jornadasRepetidas: Record<string, number> = {};

  linhas.forEach((line) => {
    if (line.horarios.length >= 2) {
      jornadasRepetidas[line.jornadaCompleta] =
        (jornadasRepetidas[line.jornadaCompleta] ?? 0) + 1;
    }
  });

  const validos = linhas.filter((line) => line.resultado?.valido).length;
  const linhasComErro = dedupeErrorLines(
    linhas.filter((line) => line.resultado?.valido === false),
  );

  return {
    arquivoOrigem: fileName,
    nomePlanilha: sheet.name,
    totalLinhas: linhas.length,
    validos,
    erros: linhasComErro.length,
    avisos: 0,
    linhas,
    linhasComErro,
    jornadasRepetidas,
  };
}
