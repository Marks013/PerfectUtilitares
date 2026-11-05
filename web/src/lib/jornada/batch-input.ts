import JSZip from "jszip";
import {
  calcularDuracaoMinutos,
  parseHorario,
} from "./time";
import type {
  JornadaBatchConfig,
  JornadaBatchLine,
} from "./batch-types";

type ParsedSheet = {
  name: string;
  rows: unknown[][];
};

const TIME_TEXT_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/;
const TEXT_HOUR_PATTERN = /\b(\d{1,2}):?(\d{2})\b/g;
const COMPACT_HOUR_PATTERN = /\b(\d{3,4})\b/g;
const INDIVIDUAL_HOUR_COLUMNS = [8, 10, 11, 13];
const XLSX_TIME_ROUNDING_TOLERANCE_SECONDS = 1;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_XLSX_ROW_INDEX = 1_048_576;
const MAX_XLSX_COLUMN_INDEX = 16_384;
const MAX_PARSED_ROWS = 25_000;
const MAX_PARSED_CELLS = 250_000;

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
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/i.exec(reference);
  if (!match || Number(match[2]) > MAX_XLSX_ROW_INDEX) {
    throw new Error("A planilha contém uma referência de célula inválida.");
  }
  return match[1]
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function readBoundedXml(entry: JSZip.JSZipObject | null) {
  if (!entry) return null;

  return new Promise<string>((resolve, reject) => {
    const stream = entry.nodeStream();
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    stream.once("error", reject);
    stream.once("end", () => {
      if (!exceeded) resolve(Buffer.concat(chunks, bytes).toString("utf8"));
    });
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_XML_BYTES) {
        exceeded = true;
        stream.pause();
        chunks.length = 0;
        reject(
          new Error("Um XML da planilha excede o limite seguro de 16 MB descompactados."),
        );
        return;
      }
      chunks.push(chunk);
    });
  });
}

function findZipEntry(zip: JSZip, candidates: string[]) {
  const names = Object.keys(zip.files);
  return candidates.find((candidate) => names.includes(candidate));
}

function extractTextNodes(xml: string) {
  const values: string[] = [];
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  for (const match of xml.matchAll(textPattern)) {
    values.push(decodeXml(match[1] ?? ""));
  }

  return values.join("");
}

function parseSharedStrings(xml: string | null) {
  if (!xml) return [];

  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;

  for (const match of xml.matchAll(itemPattern)) {
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
  let rowCount = 0;
  let cellCount = 0;

  for (const rowMatch of xml.matchAll(rowPattern)) {
    if (++rowCount > MAX_PARSED_ROWS) {
      throw new Error("A planilha ultrapassa o limite de 25 mil linhas.");
    }
    const reference = getAttribute(rowMatch[1] ?? "", "r");
    const rowNumber = reference === null ? rows.length + 1 : Number(reference);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_XLSX_ROW_INDEX) {
      throw new Error("A planilha contém um índice de linha fora do limite do Excel.");
    }
    const row: unknown[] = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;

    for (const cellMatch of (rowMatch[2] ?? "").matchAll(cellPattern)) {
      if (++cellCount > MAX_PARSED_CELLS) {
        throw new Error("A planilha ultrapassa o limite de 250 mil células.");
      }
      const reference = getAttribute(cellMatch[1] ?? "", "r");
      const columnIndex = reference ? columnIndexFromReference(reference) : row.length;
      if (columnIndex >= MAX_XLSX_COLUMN_INDEX) {
        throw new Error("A planilha contém um índice de coluna fora do limite do Excel.");
      }
      row[columnIndex] = parseCellValue(
        cellMatch[1] ?? "",
        cellMatch[2] ?? "",
        sharedStrings,
      );
    }

    rows[rowNumber - 1] = row;
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
  const sharedStringsXml = await readBoundedXml(
    sharedStringsEntry ? zip.file(sharedStringsEntry) : null,
  );
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetXml = await readBoundedXml(zip.file(sheetEntry));

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

function extrairHorariosDoTexto(value: string) {
  const horarios: string[] = [];
  const texto = cleanHorarioText(value);

  TEXT_HOUR_PATTERN.lastIndex = 0;
  for (const match of texto.matchAll(TEXT_HOUR_PATTERN)) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      horarios.push(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
    }
  }

  COMPACT_HOUR_PATTERN.lastIndex = 0;
  for (const match of texto.matchAll(COMPACT_HOUR_PATTERN)) {
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

