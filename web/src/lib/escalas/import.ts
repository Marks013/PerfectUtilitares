import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { validateXlsxArchive } from "@/lib/spreadsheets/xlsx-security";
import { EscalaError } from "./access";
import type { EscalaEmployee, EscalaShift, WeeklyHours } from "./types";
import { isFpre136Text, isFpre136Rows, previewFpre136Rows } from "./fpre136";

export const ESCALA_IMPORT_TEMPLATE = "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos\r\n0001;Nome completo;Reposição;Repositor;42;08:00-12:00 / 13:00-17:24;2020-01-01;\r\n";
const headers = ["matricula", "nome", "setor", "cargo", "cargasemanal", "horarios", "admissao"];
export type ImportOptions = { startDate: string; defaultWeeklyHours: WeeklyHours; branchCode?: string };
export type EscalaImportPreview = { employees: EscalaEmployee[]; shifts: EscalaShift[]; issues: { line: number; message: string }[]; totalRows: number;
  report?: { format: "FPRE136"; branchCode: string; branchName: string; sourceEmployees: number; otherBranchesExcluded: number; missingSchedule: number } };

function normalized(value: unknown) { return String(value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s/g, ""); }
function bounded(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  if (text.length > max || [...text].some((character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) throw new Error("Há um texto inválido ou excessivamente longo.");
  return text;
}

function parseShift(value: string): EscalaShift {
  const periods = value.split("/").map((part) => part.trim());
  if (periods.length < 1 || periods.length > 4) throw new Error("Use até quatro períodos no formato 08:00-12:00 / 13:00-17:24.");
  const work = periods.map((period) => {
    const matched = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(period);
    if (!matched) throw new Error("Horário inválido. Use 08:00-12:00 / 13:00-17:24.");
    const [, h1, m1, h2, m2] = matched.map(Number);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) throw new Error("As horas devem estar entre 00:00 e 23:59.");
    return { start: h1 * 60 + m1, end: h2 * 60 + m2, kind: "WORK" as const };
  });
  let priorEnd = -1;
  for (const period of work) {
    if (period.end <= period.start || period.start < priorEnd) throw new Error("Os períodos devem estar em ordem e não podem se sobrepor. Cadastre turnos noturnos na configuração da proposta.");
    priorEnd = period.end;
  }
  const segments: EscalaShift["segments"] = [];
  for (const period of work) {
    const previous = segments.at(-1);
    if (previous && period.start > previous.end) segments.push({ start: previous.end, end: period.start, kind: "BREAK" });
    segments.push(period);
  }
  const signature = JSON.stringify(segments);
  const fingerprint = createHash("sha256").update(signature).digest("hex");
  return { id: `imp-${fingerprint.slice(0, 16)}`, name: `Horário ${fingerprint.slice(0, 8)}`, segments };
}

export function previewEscalaRows(rows: unknown[][], options: ImportOptions): EscalaImportPreview {
  if (isFpre136Rows(rows)) return previewFpre136Rows(rows, options, parseShift);
  if (rows.length > 251) throw new EscalaError(400, "ESCALA_IMPORT_LIMIT", "A importação aceita até 250 colaboradores por proposta.");
  if (rows.length < 2 || headers.some((header, index) => normalized(rows[0]?.[index]) !== header)) {
    throw new EscalaError(400, "ESCALA_IMPORT_LAYOUT", "Use o modelo de Escalas com as colunas Matricula, Nome, Setor, Cargo, CargaSemanal, Horarios e Admissao. Relatórios de folha não contêm todos os dados necessários.");
  }
  const result: EscalaImportPreview = { employees: [], shifts: [], issues: [], totalRows: rows.length - 1 };
  const registrations = new Set<string>();
  const shifts = new Map<string, EscalaShift>();
  rows.slice(1).forEach((row, index) => {
    if (row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "")) return;
    const line = index + 2;
    try {
      const registration = bounded(row[0], 60), name = bounded(row[1], 160), sector = bounded(row[2], 120), role = bounded(row[3], 120);
      if (!registration || !name || !sector || !role) throw new Error("Matrícula, nome, setor e cargo são obrigatórios; nenhuma classificação será inferida.");
      if (registrations.has(registration)) throw new Error("Matrícula duplicada nesta prévia. Registros não foram unidos pelo nome.");
      const hoursText = bounded(row[4], 10);
      const weeklyHours = hoursText === "" ? options.defaultWeeklyHours : Number(hoursText);
      if (![40, 42, 44].includes(weeklyHours)) throw new Error("Carga semanal deve ser 40, 42 ou 44 horas.");
      const shift = parseShift(bounded(row[5], 180));
      const admission = row[6] instanceof Date ? row[6].toISOString().slice(0, 10) : bounded(row[6], 10);
      const parsedAdmission = new Date(`${admission}T00:00:00Z`);
      if (!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(admission) || Number.isNaN(parsedAdmission.valueOf()) || parsedAdmission.toISOString().slice(0, 10) !== admission) {
        throw new Error("Informe a data real de admissão no formato AAAA-MM-DD. O início da escala não será tratado como contratação.");
      }
      const id = `imp-${createHash("sha256").update(registration).digest("hex").slice(0, 24)}`;
      const sundayRule = normalized(rows[0]?.[7]) === "regradomingos" ? bounded(row[7], 30).toUpperCase() : "";
      if (sundayRule && !["UNREVIEWED", "CLT_386", "COMMERCE"].includes(sundayRule)) throw new Error("RegraDomingos deve ser CLT_386 (quinzenal), COMMERCE (três semanas) ou UNREVIEWED. O enquadramento não será inferido pelo nome.");
      result.employees.push({ id, registration, name, sector, role, weeklyHours: weeklyHours as WeeklyHours, weeklyHoursMode: hoursText === "" ? "BRANCH" : "INDIVIDUAL", shiftIds: [shift.id],
        activeFrom: admission, offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: sundayRule === "COMMERCE" ? 2 : 1,
        sundayRestRule: sundayRule === "COMMERCE" ? "COMMERCE" : sundayRule === "CLT_386" ? "CLT_386" : "UNREVIEWED",
        preferredOffDays: [], historyKnown: false, history: [] });
      shifts.set(shift.id, shift);
      registrations.add(registration);
    } catch (error) { result.issues.push({ line, message: error instanceof Error ? error.message : "Linha inválida." }); }
  });
  result.shifts = [...shifts.values()];
  return result;
}

export async function previewEscalaImport(buffer: Buffer, extension: "csv" | "xlsx", options: ImportOptions) {
  let rows: unknown[][];
  if (extension === "xlsx") {
    validateXlsxArchive(buffer, { strict: true, maxEntryUncompressedBytes: 4 * 1024 * 1024, maxTotalUncompressedBytes: 16 * 1024 * 1024 });
    try { rows = await readSheet(buffer); }
    catch { throw new EscalaError(400, "ESCALA_IMPORT_XLSX", "Não foi possível ler este XLSX. Exporte o relatório FPRE136 como CSV e envie o arquivo completo."); }
  } else {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch (error) {
      text = new TextDecoder("windows-1252").decode(buffer);
      if (!isFpre136Text(text)) throw error;
    }
    text = text.replace(/^\uFEFF/, "");
    const report = isFpre136Text(text);
    const first = text.split(/\r?\n/, 1)[0];
    rows = parse(text, { delimiter: report ? "," : first.includes(";") ? ";" : ",", bom: true, skip_empty_lines: true, max_record_size: 8192, relax_column_count: report }) as unknown[][];
  }
  return previewEscalaRows(rows, options);
}
