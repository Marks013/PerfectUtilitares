import { parse } from "csv-parse/sync";
import { EscalaError } from "./access";
import type { EscalaAssignment } from "./types";

export type AbsenceImportOptions = {
  startDate: string; endDate: string; visibleMonth?: string;
  employees: { id: string; registration: string }[];
};
export type AbsenceImportPreview = {
  assignments: EscalaAssignment[];
  counts: { totalRows: number; matchedRows: number; unmatchedRows: number; ambiguousRows: number; outsidePeriodRows: number; invalidRows: number; openEndedRows: number; employees: number; days: number };
  issues: { line: number; code: string; message: string }[];
  reportPeriod?: { startDate: string; endDate: string };
};

const DAY = 86_400_000;
const normalized = (value: unknown) => String(value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const numericRegistration = (value: string) => /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;

export function isAbsenceImportDate(value: string) {
  if (!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function reportDate(value: unknown): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isAbsenceImportDate(iso) ? iso : null;
}

function isHeader(row: string[]) {
  const expected = ["empresa", "tipo", "cadastro", "nome", "funcao", "admissao", "afastamento", "cid", "situacao", "termino", "dias"];
  return expected.every((cell, index) => normalized(row[index]) === cell);
}

/** FPHI105 contains medical columns. Only registration and absence dates leave this parser. */
export function previewFphi105Import(buffer: Buffer, options: AbsenceImportOptions): AbsenceImportPreview {
  const span = (Date.parse(options.endDate) - Date.parse(options.startDate)) / DAY;
  if (!isAbsenceImportDate(options.startDate) || !isAbsenceImportDate(options.endDate) || span < 0 || span > 41 || options.employees.length > 250) {
    throw new EscalaError(400, "ESCALA_ABSENCE_OPTIONS", "Selecione um período de até 42 dias e uma equipe de até 250 colaboradores.");
  }
  if (!buffer.length || buffer.length > 512 * 1024) throw new EscalaError(400, "ESCALA_IMPORT_FILE", "Envie um CSV FPHI105 de até 512 KB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder("windows-1252").decode(buffer); }
  if (text.includes("\0")) throw new EscalaError(400, "ESCALA_IMPORT_CONTENT", "O arquivo não contém um CSV FPHI105 válido.");
  const rows = parse(text, { delimiter: ",", bom: true, skip_empty_lines: true, max_record_size: 8192, relax_column_count: true }) as string[][];
  if (rows.length > 5000) throw new EscalaError(400, "ESCALA_IMPORT_LIMIT", "O relatório excede o limite de 5.000 linhas.");
  if (!rows.some(isHeader)) throw new EscalaError(400, "ESCALA_ABSENCE_LAYOUT", "Envie o relatório FPHI105 em CSV, com as colunas de início e término dos afastamentos.");
  const result: AbsenceImportPreview = { assignments: [], counts: { totalRows: 0, matchedRows: 0, unmatchedRows: 0, ambiguousRows: 0, outsidePeriodRows: 0, invalidRows: 0, openEndedRows: 0, employees: 0, days: 0 }, issues: [] };
  const issue = (line: number, code: string, message: string) => { result.issues.push({ line, code, message }); };
  const periods = rows.flatMap((row) => {
    const startDate = reportDate(row[1]), endDate = reportDate(row[3]);
    return startDate && endDate && startDate <= endDate ? [{ startDate, endDate }] : [];
  });
  if (periods.length) {
    result.reportPeriod = periods[0];
    if (periods.some((period) => period.startDate !== periods[0].startDate || period.endDate !== periods[0].endDate)) issue(0, "REPORT_PERIOD_CONFLICT", "O arquivo contém períodos diferentes. Confira as datas antes de aplicar.");
    const month = options.visibleMonth;
    if (month && (periods[0].startDate.slice(0, 7) !== month || periods[0].endDate.slice(0, 7) !== month)) issue(0, "REPORT_PERIOD_MISMATCH", "O período do relatório difere do mês da escala. Somente os dias dentro do planejamento serão considerados.");
  }
  const employeeRows = rows.map((row, index) => ({ row, line: index + 1 })).filter(({ row }) => row.length >= 3 && [0, 1, 2].every((index) => /^\d+$/.test(row[index]?.trim())));
  const identities = new Map<string, Set<string>>();
  for (const { row } of employeeRows) {
    const key = numericRegistration(row[2].trim());
    const companies = identities.get(key) ?? new Set<string>();
    companies.add(`${row[0].trim()}:${row[1].trim()}`);
    identities.set(key, companies);
  }
  const byExact = new Map<string, { id: string; registration: string }[]>();
  const byNumeric = new Map<string, { id: string; registration: string }[]>();
  for (const person of options.employees) {
    const exact = person.registration.trim(), numeric = numericRegistration(exact);
    byExact.set(exact, [...(byExact.get(exact) ?? []), person]);
    byNumeric.set(numeric, [...(byNumeric.get(numeric) ?? []), person]);
  }
  const days = new Map<string, EscalaAssignment>();
  for (const { row, line } of employeeRows) {
    result.counts.totalRows++;
    const registration = row[2].trim(), numeric = numericRegistration(registration);
    const matches = byExact.get(registration) ?? byNumeric.get(numeric) ?? [];
    if (matches.length > 1 || (identities.get(numeric)?.size ?? 0) > 1) {
      result.counts.ambiguousRows++; issue(line, "AMBIGUOUS_REGISTRATION", "Matrícula ambígua entre colaboradores, empresas ou tipos de contrato. Confira o cadastro; a linha não será aplicada."); continue;
    }
    if (!matches.length) { result.counts.unmatchedRows++; continue; }
    if (row.length !== 13) { result.counts.invalidRows++; issue(line, "INVALID_COLUMNS", "Linha incompleta: exporte novamente o relatório FPHI105 em CSV."); continue; }
    const start = reportDate(row[6]);
    const endText = row[11].trim();
    const openEnded = !endText || /^0{2}\/0{2}\/0{4}$/.test(endText);
    const end = openEnded ? options.endDate : reportDate(endText);
    const situation = normalized(row[10]);
    if (!start || !end || (!openEnded && start > end) || !/^(?:ferias\b|afastad|afastamento\b|licenca\b|atestado\b|auxilio\b|maternidade\b|paternidade\b|doenca\b|acidente\b|suspensao\b)/.test(situation)) {
      result.counts.invalidRows++; issue(line, "INVALID_ABSENCE", "Confira o início, o término e se a situação representa um afastamento. A linha não será aplicada."); continue;
    }
    if (end < options.startDate || start > options.endDate) { result.counts.outsidePeriodRows++; continue; }
    result.counts.matchedRows++;
    if (openEnded) { result.counts.openEndedRows++; issue(line, "OPEN_ENDED_ABSENCE", "Sem término informado: a ausência será considerada somente até o fim deste planejamento. Confira antes de aplicar."); }
    const first = start < options.startDate ? options.startDate : start, last = end > options.endDate ? options.endDate : end;
    for (let value = Date.parse(first); value <= Date.parse(last); value += DAY) {
      const date = new Date(value).toISOString().slice(0, 10), employeeId = matches[0].id;
      days.set(`${employeeId}:${date}`, { employeeId, date, kind: "ABSENCE" });
    }
  }
  if (!employeeRows.length) issue(0, "NO_ABSENCE_ROWS", "Nenhum afastamento foi encontrado no relatório. Nenhuma alteração será aplicada.");
  result.assignments = [...days.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  result.counts.days = result.assignments.length;
  result.counts.employees = new Set(result.assignments.map((item) => item.employeeId)).size;
  return result;
}

export { mergeAbsenceAssignments } from "./absence-merge";
