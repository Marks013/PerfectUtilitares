import { parse } from "csv-parse/sync";
import { canonicalBranchCode } from "./branch-code";
import { EscalaError } from "./errors";
import type { EscalaAssignment } from "./types";

export type AbsenceImportOptions = {
  startDate: string; endDate: string; visibleMonth?: string; branchCode?: string;
  employees: { id: string; registration: string }[];
  onLayoutRecognized?: (layout: "FPHI105") => void;
};
export type AbsenceImportPreview = {
  replacement?: { unrecognizedRows: number; numericMatches: { line: number; employeeId: string }[] };
  assignments: EscalaAssignment[];
  counts: { totalRows: number; matchedRows: number; unmatchedRows: number; ambiguousRows: number; outsidePeriodRows: number; invalidRows: number; openEndedRows: number; employees: number; days: number };
  issues: { line: number; code: string; message: string }[];
  reportPeriod?: { startDate: string; endDate: string };
};

const DAY = 86_400_000;
const normalized = (value: unknown) => String(value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const numericRegistration = (value: string) => /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;
const branchSection = /^(\d{2})\.\d+\s*,\s*[^,]+,\s*.+$/;
const pageLabel = /^pag\.:?$/;
const reportPeriodLabel = /^periodo\s*:?$/;
const footerLabel = /^fphi105\.col\s*-/;

type Fphi105Record = {
  line: number; companyCode: string; employmentType: string; branchCode?: string;
  registration: string; startDate: string; endDate: string | null;
};
type Fphi105Report = {
  records: Fphi105Record[]; reportPeriod?: NonNullable<AbsenceImportPreview["reportPeriod"]>;
  issues: AbsenceImportPreview["issues"]; invalidRows: number; unrecognizedRows: number;
  totalRows: number; hasBranchSections: boolean;
};

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

function isAbsenceSituation(code: string, label: string) {
  const situation = normalized(label).replace(/\s+/g, " ");
  return /^(?:ferias\b|afastad|afastamento\b|licenca\b|lic\.\s*medica\b|atestado\b|auxilio\b|maternidade\b|paternidade\b|doenca\b|acidente\b|suspensao\b)/.test(situation)
    || numericRegistration(code) === "8" && /^lic\.\s*s\/\s*remuneracao$/.test(situation)
    || numericRegistration(code) === "17" && /^aposent\.\s*invalidez$/.test(situation)
    || numericRegistration(code) === "368" && situation === "detencao";
}

/** Parse source intervals without projecting a planning horizon or retaining sensitive columns. */
export function parseFphi105Report(buffer: Buffer): Fphi105Report {
  if (!buffer.length || buffer.length > 512 * 1024) throw new EscalaError(400, "ESCALA_IMPORT_FILE", "Envie um CSV FPHI105 de até 512 KB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder("windows-1252").decode(buffer); }
  if (text.includes("\0")) throw new EscalaError(400, "ESCALA_IMPORT_CONTENT", "O arquivo não contém um CSV FPHI105 válido.");
  let rows: string[][];
  try {
    rows = parse(text, { delimiter: ",", bom: true, max_record_size: 8192, relax_column_count: true }) as string[][];
  } catch {
    throw new EscalaError(400, "ESCALA_IMPORT_CONTENT", "O arquivo não contém um CSV FPHI105 válido.");
  }
  if (rows.length > 5000) throw new EscalaError(400, "ESCALA_IMPORT_LIMIT", "O relatório excede o limite de 5.000 linhas.");
  if (!rows.some(isHeader)) throw new EscalaError(400, "ESCALA_ABSENCE_LAYOUT", "Envie o relatório FPHI105 em CSV, com as colunas de início e término dos afastamentos.");
  const result: Fphi105Report = { records: [], issues: [], invalidRows: 0, unrecognizedRows: 0, totalRows: 0,
    hasBranchSections: rows.some(row => row.length === 1 && branchSection.test(row[0].trim())) };
  const issue = (line: number, code: string, message: string) => { result.issues.push({ line, code, message }); };
  const invalidStructure = (line: number, code: string, message: string) => { result.unrecognizedRows++; issue(line, code, message); };
  const hasPages = rows.some(row => pageLabel.test(normalized(row[2])));
  const hasFooters = rows.some(row => row.length === 1 && footerLabel.test(normalized(row[0])));
  const pageNumbers = new Map<string, number>();
  let branchCode: string | undefined, pageCompany: string | undefined, pageLine = 0;
  let headerSeen = false, pageHasHeader = false, pageClosed = false;
  const checkPage = () => {
    if (pageLine && (!pageHasHeader || hasFooters && !pageClosed)) {
      invalidStructure(pageLine, "INVALID_REPORT_PAGE", "Há página incompleta no relatório. Exporte novamente o FPHI105 completo.");
    }
  };
  let nextLine = 1;
  for (const row of rows) {
    const line = nextLine;
    nextLine += 1 + row.reduce((count, field) => count + (field.match(/\r\n|[\r\n]/g)?.length ?? 0), 0);
    if (row.every(value => !value.trim())) continue;
    if (pageLabel.test(normalized(row[2]))) {
      checkPage();
      const company = (row[0] ?? "").trim(), number = (row[3] ?? "").trim();
      pageLine = line; branchCode = undefined; headerSeen = false; pageHasHeader = false; pageClosed = false;
      pageCompany = /^\d{1,20}$/.test(company) ? numericRegistration(company) : undefined;
      const expected = (pageCompany ? pageNumbers.get(pageCompany) ?? 0 : 0) + 1;
      if (!pageCompany || !/^\d{1,9}$/.test(number) || Number(number) !== expected) {
        invalidStructure(line, "INVALID_REPORT_PAGE", "Há recorte, lacuna ou repetição de páginas. Exporte novamente o FPHI105 completo.");
      }
      if (pageCompany && /^\d{1,9}$/.test(number)) pageNumbers.set(pageCompany, Number(number));
      continue;
    }
    if (row.length === 1 && footerLabel.test(normalized(row[0]))) {
      if (!pageLine || pageClosed) invalidStructure(line, "INVALID_REPORT_PAGE", "O rodapé do FPHI105 não corresponde à página.");
      pageClosed = true;
      continue;
    }
    if (hasPages && (!pageLine || pageClosed)) {
      invalidStructure(line, "INVALID_REPORT_CONTEXT", "Há conteúdo fora de uma página do FPHI105.");
      continue;
    }
    if (reportPeriodLabel.test(normalized(row[0]))) {
      const startDate = reportDate(row[1]), endDate = reportDate(row[3]);
      if (!startDate || !endDate || startDate > endDate || normalized(row[2]) !== "a") {
        invalidStructure(line, "REPORT_PERIOD_CONFLICT", "O período declarado no FPHI105 é inválido.");
      } else if (!result.reportPeriod) result.reportPeriod = { startDate, endDate };
      else if (startDate !== result.reportPeriod.startDate || endDate !== result.reportPeriod.endDate) {
        invalidStructure(line, "REPORT_PERIOD_CONFLICT", "O arquivo contém períodos diferentes. Confira as datas antes de aplicar.");
      }
      continue;
    }
    const section = row.length === 1 ? branchSection.exec(row[0].trim()) : null;
    if (section) { branchCode = canonicalBranchCode(section[1]); headerSeen = false; continue; }
    if (isHeader(row)) { headerSeen = true; pageHasHeader = true; continue; }
    if (![0, 1, 2].every(column => /^\d+$/.test(row[column]?.trim()))) {
      result.unrecognizedRows++;
      // An unrecognized section cannot give its branch context to the following rows.
      if (result.hasBranchSections && row.length === 1) { branchCode = undefined; headerSeen = false; }
      continue;
    }
    result.totalRows++;
    if (row.length !== 13) {
      result.invalidRows++;
      issue(line, "INVALID_COLUMNS", "Linha incompleta: exporte novamente o relatório FPHI105 em CSV.");
      continue;
    }
    const companyCode = row[0].trim(), employmentType = row[1].trim(), registration = row[2].trim();
    if (result.hasBranchSections && (!branchCode || !headerSeen) || hasPages && (numericRegistration(companyCode) !== pageCompany || !headerSeen)) {
      invalidStructure(line, "INVALID_REPORT_CONTEXT", "Não foi possível vincular a linha a uma empresa e seção do FPHI105.");
      continue;
    }
    const startDate = reportDate(row[6]), endText = row[11].trim();
    const openEnded = !endText || endText === "00/00/0000", endDate = openEnded ? null : reportDate(endText);
    if (!startDate || (!openEnded && (!endDate || startDate > endDate)) || !isAbsenceSituation(row[9].trim(), row[10])) {
      result.invalidRows++;
      issue(line, "INVALID_ABSENCE", "Confira o início, o término e se a situação representa um afastamento. A linha não será aplicada.");
      continue;
    }
    result.records.push({ line, companyCode, employmentType, ...(branchCode ? { branchCode } : {}), registration, startDate, endDate });
  }
  checkPage();
  return result;
}

/** Resolve report identities in the selected team and project only within its planning horizon. */
export function previewFphi105Import(buffer: Buffer, options: AbsenceImportOptions): AbsenceImportPreview {
  const span = (Date.parse(options.endDate) - Date.parse(options.startDate)) / DAY;
  if (!isAbsenceImportDate(options.startDate) || !isAbsenceImportDate(options.endDate) || span < 0 || span > 41 || options.employees.length > 250) {
    throw new EscalaError(400, "ESCALA_ABSENCE_OPTIONS", "Selecione um período de até 42 dias e uma equipe de até 250 colaboradores.");
  }
  const report = parseFphi105Report(buffer);
  options.onLayoutRecognized?.("FPHI105");
  const branchCode = options.branchCode ? canonicalBranchCode(options.branchCode) : undefined;
  if (report.hasBranchSections && !branchCode) throw new EscalaError(400, "ESCALA_ABSENCE_OPTIONS", "Selecione a filial do relatório FPHI105.");
  const records = report.records.filter(record => !report.hasBranchSections || record.branchCode === branchCode);
  const result: AbsenceImportPreview = { assignments: [], counts: { totalRows: report.totalRows - report.records.length + records.length, matchedRows: 0, unmatchedRows: 0, ambiguousRows: 0, outsidePeriodRows: 0, invalidRows: report.invalidRows, openEndedRows: 0, employees: 0, days: 0 }, issues: [...report.issues],
    replacement: { unrecognizedRows: report.unrecognizedRows, numericMatches: [] } };
  const issue = (line: number, code: string, message: string) => { result.issues.push({ line, code, message }); };
  if (report.reportPeriod) {
    result.reportPeriod = report.reportPeriod;
    const month = options.visibleMonth;
    if (month && (report.reportPeriod.startDate.slice(0, 7) !== month || report.reportPeriod.endDate.slice(0, 7) !== month)) issue(0, "REPORT_PERIOD_MISMATCH", "O período do relatório difere do mês da escala. Somente os dias dentro do planejamento serão considerados.");
  }
  const identities = new Map<string, Set<string>>();
  for (const { registration, companyCode, employmentType } of report.records) {
    const key = numericRegistration(registration);
    const companies = identities.get(key) ?? new Set<string>();
    companies.add(`${numericRegistration(companyCode)}:${numericRegistration(employmentType)}`);
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
  for (const { registration, line, startDate: start, endDate } of records) {
    const end = endDate ?? options.endDate;
    if (end < options.startDate || start > options.endDate) { result.counts.outsidePeriodRows++; continue; }
    const numeric = numericRegistration(registration);
    const matches = byExact.get(registration) ?? byNumeric.get(numeric) ?? [];
    if (matches.length > 1 || (identities.get(numeric)?.size ?? 0) > 1) {
      result.counts.ambiguousRows++; issue(line, "AMBIGUOUS_REGISTRATION", "A matrícula corresponde a mais de um vínculo. Confira a equipe e o relatório."); continue;
    }
    if (!matches.length) {
      result.counts.unmatchedRows++; issue(line, "UNMATCHED_REGISTRATION", "A matrícula não corresponde a um colaborador da equipe selecionada."); continue;
    }
    result.counts.matchedRows++;
    if (!byExact.has(registration) && result.replacement) result.replacement.numericMatches.push({ line, employeeId: matches[0].id });
    if (endDate === null) { result.counts.openEndedRows++; issue(line, "OPEN_ENDED_ABSENCE", "Sem data de retorno: a prévia mostra os dias deste planejamento sem definir o fim do afastamento."); }
    const first = start < options.startDate ? options.startDate : start, last = end > options.endDate ? options.endDate : end;
    for (let value = Date.parse(first); value <= Date.parse(last); value += DAY) {
      const date = new Date(value).toISOString().slice(0, 10), employeeId = matches[0].id;
      days.set(`${employeeId}:${date}`, { employeeId, date, kind: "ABSENCE" });
    }
  }
  if (!result.counts.totalRows) issue(0, "NO_ABSENCE_ROWS", "Nenhum afastamento foi encontrado para a filial. Nenhuma alteração será aplicada.");
  result.assignments = [...days.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  result.counts.days = result.assignments.length;
  result.counts.employees = new Set(result.assignments.map((item) => item.employeeId)).size;
  result.issues.sort((a, b) => a.line - b.line);
  return result;
}

export { mergeAbsenceAssignments } from "./absence-merge";
