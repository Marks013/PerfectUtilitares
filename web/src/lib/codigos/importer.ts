import { parse as parseCsv } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";
import {
  normalizarHorarios,
  validarHorariosNormalizados,
} from "./horario-normalizer";

export type CodigoImportOrigem = "XLSX" | "CSV" | "JSON";

export type CodigoImportRow = {
  codigo: string;
  horariosOriginal: string;
  horariosNormalizado: string;
  origem: CodigoImportOrigem;
  linha: number;
};

export type CodigoImportLineError = {
  linha: number;
  mensagem: string;
  valor?: unknown;
};

export type CodigoImportParseResult = {
  totalLido: number;
  importaveis: CodigoImportRow[];
  ignorados: number;
  erros: CodigoImportLineError[];
};

const codigoInputSchema = z.object({
  codigo: z.coerce.string().trim().min(1, "Código obrigatório"),
  horariosOriginal: z.coerce.string().trim().min(1, "Horários obrigatórios"),
});

function isEmpty(value: unknown): boolean {
  return value == null || String(value).trim() === "";
}

function valueToString(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }

  return String(value).trim();
}

function isHeaderRow(codigo: string, horarios: string): boolean {
  const left = codigo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const right = horarios
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return (
    (left === "horario" || left === "codigo") &&
    (right === "descricao" || right === "horarios" || right === "jornada")
  );
}

function toImportRow(
  rawCodigo: unknown,
  rawHorarios: unknown,
  origem: CodigoImportOrigem,
  linha: number,
): { row?: CodigoImportRow; ignored?: true; error?: CodigoImportLineError } {
  if (isEmpty(rawCodigo) && isEmpty(rawHorarios)) {
    return { ignored: true };
  }

  const codigo = valueToString(rawCodigo);
  const horariosOriginal = valueToString(rawHorarios);

  if (isHeaderRow(codigo, horariosOriginal)) {
    return { ignored: true };
  }

  const parsed = codigoInputSchema.safeParse({ codigo, horariosOriginal });
  if (!parsed.success) {
    return {
      error: {
        linha,
        mensagem: parsed.error.issues.map((issue) => issue.message).join("; "),
        valor: [rawCodigo, rawHorarios],
      },
    };
  }

  const horariosNormalizado = normalizarHorarios(parsed.data.horariosOriginal);
  const validacao = validarHorariosNormalizados(horariosNormalizado);

  if (!validacao.valido) {
    return {
      error: {
        linha,
        mensagem: validacao.mensagem,
        valor: parsed.data,
      },
    };
  }

  return {
    row: {
      codigo: parsed.data.codigo,
      horariosOriginal: parsed.data.horariosOriginal,
      horariosNormalizado,
      origem,
      linha,
    },
  };
}

function collectRows(
  rows: unknown[][],
  origem: CodigoImportOrigem,
): CodigoImportParseResult {
  const result: CodigoImportParseResult = {
    totalLido: rows.length,
    importaveis: [],
    ignorados: 0,
    erros: [],
  };

  rows.forEach((row, index) => {
    const linha = index + 1;
    const parsed = toImportRow(row[0], row[1], origem, linha);

    if (parsed.row) {
      result.importaveis.push(parsed.row);
    } else if (parsed.ignored) {
      result.ignorados += 1;
    } else if (parsed.error) {
      result.erros.push(parsed.error);
    }
  });

  return result;
}

export async function parseCodigoXlsxBuffer(
  buffer: Buffer,
): Promise<CodigoImportParseResult> {
  const rows = await readSheet(buffer);
  return collectRows(rows as unknown[][], "XLSX");
}

export function parseCodigoCsvBuffer(buffer: Buffer): CodigoImportParseResult {
  const records = parseCsv(buffer.toString("utf8"), {
    bom: true,
    delimiter: [",", ";", "\t"],
    relax_column_count: true,
    skip_empty_lines: false,
    trim: true,
  }) as unknown[][];

  return collectRows(records, "CSV");
}

export function parseCodigoJsonBuffer(buffer: Buffer): CodigoImportParseResult {
  return parseCodigoJson(JSON.parse(buffer.toString("utf8")));
}

export function parseCodigoJson(payload: unknown): CodigoImportParseResult {
  const rows: unknown[][] = [];

  if (Array.isArray(payload)) {
    payload.forEach((item) => {
      if (Array.isArray(item)) {
        rows.push([item[0], item[1]]);
        return;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        rows.push([
          record.codigo,
          record.horariosOriginal ?? record.horarios ?? record.descricao,
        ]);
      }
    });
  } else if (payload && typeof payload === "object") {
    Object.entries(payload as Record<string, unknown>).forEach(
      ([horarios, codigo]) => {
        rows.push([codigo, horarios]);
      },
    );
  }

  return collectRows(rows, "JSON");
}

export async function parseCodigoImportBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<CodigoImportParseResult> {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".xlsx")) {
    return parseCodigoXlsxBuffer(buffer);
  }

  if (lowerName.endsWith(".csv")) {
    return parseCodigoCsvBuffer(buffer);
  }

  if (lowerName.endsWith(".json")) {
    return parseCodigoJsonBuffer(buffer);
  }

  throw new Error("Formato não suportado. Use .xlsx, .csv ou .json");
}
