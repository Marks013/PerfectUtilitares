import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { EscalaError } from "./errors";
import type { EscalaImportPreview, ImportOptions } from "./import";
import { sortEmployees } from "./order";
import { applyRestEligibility } from "./eligibility";
import type { EscalaShift } from "./types";
import { canonicalBranchCode as normalizeBranch } from "./branch-code";
import { classifyFpre136Schedule } from "./fpre136-schedule";
import { inferLeadership } from "./leadership";
import type { ImportSyncMissingRegistration } from "./import-sync-contracts";

const cell = (value: unknown) => String(value ?? "").trim();
const sectorPattern = /^(\d{2})\.\d+\s*,\s*([^,]+),\s*(.+)$/;
const isPageHeader = (row: unknown[]) => cell(row[1]) === "-" && /^P[áa]g\.:$/i.test(cell(row[3]));

/** Only this report signature enables heterogeneous records and Windows-1252. */
export function isFpre136Text(text: string) {
  return /^"?Quadro de Hor[áa]rios"?\s*$/mi.test(text)
    && /^"?"?,"?Nome"?,"?Cargo"?,"?Hor[áa]rio"?\s*$/mi.test(text)
    && /^"?\d+"?,"?-"?,.+,"?P[áa]g\.:"?,"?\s*\d+\s*"?\s*$/mi.test(text);
}

export function isFpre136Rows(rows: unknown[][]) {
  return rows.some((row) => cell(row[0]) === "Quadro de Horários")
    && rows.some((row) => cell(row[1]) === "Nome" && cell(row[2]) === "Cargo" && cell(row[3]) === "Horário")
    && rows.some(isPageHeader);
}

/** Discover complete-file branch scopes; the regular parser still validates each employee and page. */
export function discoverFpre136Branches(file: Buffer) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(file); }
  catch { text = new TextDecoder("windows-1252").decode(file); }
  if (!isFpre136Text(text)) throw new EscalaError(422, "ESCALA_WORKFORCE_UNREVIEWABLE_IMPORT", "Envie o relatório completo FPRE136 em CSV.");
  const rows: unknown[][] = parse(text, { delimiter: ",", bom: true, skip_empty_lines: true, max_record_size: 8192, relax_column_count: true });
  const companies = new Set<string>(), branches = new Set<string>();
  for (const row of rows) {
    if (isPageHeader(row)) companies.add(cell(row[0]).replace(/^0+(?=\d)/, ""));
    const sector = row.length === 1 ? sectorPattern.exec(cell(row[0])) : null;
    if (sector) branches.add(normalizeBranch(sector[1]));
  }
  const [companyCode] = companies;
  if (companies.size !== 1 || !/^\d{1,60}$/.test(companyCode) || !branches.size) throw new EscalaError(422, "ESCALA_WORKFORCE_UNREVIEWABLE_IMPORT", "O relatório deve identificar uma única empresa e suas filiais.");
  return { companyCode, branchCodes: [...branches].sort() };
}

function required(value: unknown, max: number) {
  const text = cell(value);
  if (!text || text.length > max || [...text].some((character) => character.charCodeAt(0) < 32)) throw new Error("Campo obrigatório inválido no FPRE136.");
  return text;
}

export function previewFpre136Rows(rows: unknown[][], options: ImportOptions & { allowExplicitEmptySections?: boolean }, parseShift: (value: string) => EscalaShift): EscalaImportPreview {
  if (!options.branchCode?.trim()) throw new EscalaError(400, "ESCALA_IMPORT_BRANCH", "Selecione a filial para importar o FPRE136.");
  const branchCode = normalizeBranch(options.branchCode);
  const selected: { row: unknown[]; line: number; sector: string; code: string; description: string; saturday?: unknown[] }[] = [];
  let context: { branchCode: string; branchName: string; sector: string } | undefined;
  const paginationIssues: NonNullable<NonNullable<EscalaImportPreview["replacement"]>["paginationIssues"]> = [];
  const pageByCompany = new Map<string, number>();
  let pageCompany: string | undefined, sectorCompany: string | undefined, scheduleCompany: string | undefined;
  let code = "", description = "", branchName = "", sourceEmployees = 0, unrecognizedRows = 0;
  let explicitSection = false;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const line = options.sourceLines?.[index] ?? index + 1;
    const sector = row.length === 1 ? sectorPattern.exec(cell(row[0])) : null;
    if (isPageHeader(row)) {
      const company = cell(row[0]), pageText = cell(row[4]), page = Number(pageText);
      pageCompany = /^\d{1,60}$/.test(company) ? company.replace(/^0+(?=\d)/, "") : undefined;
      if (!pageCompany || !/^\d{1,9}$/.test(pageText) || page < 1 || row.slice(5).some(value => cell(value))) {
        paginationIssues.push({ line, code: "PAGE_HEADER", message: "Cabeçalho de página sem empresa ou número válido. Exporte o relatório completo." });
      } else {
        const expected = (pageByCompany.get(pageCompany) ?? 0) + 1;
        if (page !== expected) paginationIssues.push({ line, code: "PAGE_SEQUENCE", message: "Há recorte, lacuna ou repetição na sequência de páginas da empresa. Exporte o relatório completo." });
        pageByCompany.set(pageCompany, page);
      }
    } else if (sector) {
      context = { branchCode: sector[1], branchName: sector[2].trim(), sector: sector[3].trim() };
      sectorCompany = pageCompany; scheduleCompany = undefined;
      code = ""; description = "";
      if (context.branchCode === branchCode) branchName = context.branchName;
    } else if (cell(row[0]) === "Horário:") {
      code = cell(row[1]); description = cell(row[3]);
      scheduleCompany = sectorCompany === pageCompany ? pageCompany : undefined;
      if (context?.branchCode === branchCode && context.branchName && context.sector && scheduleCompany && code && description) {
        explicitSection = true;
      }
    } else if (row.length === 10 && cell(row[1]) === "-" && (/^\d+$/.test(cell(row[0])) || (!cell(row[0]) && options.registrationCorrections))) {
      if (!pageCompany || sectorCompany !== pageCompany || scheduleCompany !== pageCompany) paginationIssues.push({ line, code: "PAGE_CONTEXT", message: "Não foi possível vincular filial e horário à empresa da página. Exporte o relatório completo." });
      sourceEmployees++;
      if (!context) throw new EscalaError(400, "ESCALA_IMPORT_LAYOUT", "Funcionário sem contexto de filial e setor no FPRE136.");
      if (context.branchCode !== branchCode) continue;
      selected.push({ row, line, sector: context.sector, code, description,
        saturday: cell(rows[index + 1]?.[0]) === "Sábado:" ? rows[index + 1] : undefined });
    } else if (row.some(value => cell(value)) && cell(row[0]) !== "Quadro de Horários" && cell(row[0]) !== "Sábado:"
      && !(cell(row[1]) === "Nome" && cell(row[2]) === "Cargo" && cell(row[3]) === "Horário")
      && !isPageHeader(row)) {
      unrecognizedRows++;
    }
  }
  if (!branchName || !selected.length && !(options.allowExplicitEmptySections && explicitSection)) {
    throw new EscalaError(400, "ESCALA_IMPORT_BRANCH", "A filial selecionada não contém colaboradores nem seção verificável neste FPRE136.");
  }
  if (selected.length > 250) throw new EscalaError(400, "ESCALA_IMPORT_LIMIT", "A importação aceita até 250 colaboradores da filial por proposta.");
  const result: EscalaImportPreview = { employees: [], shifts: [], issues: [], totalRows: selected.length,
    replacement: { rejectedRows: unrecognizedRows, invalidIdentityRows: 0, fieldsById: {}, paginationIssues },
    report: { format: "FPRE136", branchCode, branchName, sourceEmployees, otherBranchesExcluded: sourceEmployees - selected.length, missingSchedule: 0 } };
  // Count only records from the selected branch, excluding every repeated
  // registration rather than allowing its first occurrence through the preview.
  const missingRegistrations: ImportSyncMissingRegistration[] = [];
  const registrationAt = (record: typeof selected[number]) => {
    const source = cell(record.row[0]);
    const supplied = options.registrationCorrections?.get(record.line);
    return source || (supplied && /^\d{1,60}$/.test(supplied) ? supplied : "");
  };
  const registrationCounts = new Map<string, number>();
  for (const record of selected) {
    const registration = registrationAt(record);
    if (registration) registrationCounts.set(registration, (registrationCounts.get(registration) ?? 0) + 1);
  }
  const shifts = new Map<string, EscalaShift>();
  for (const record of selected) {
    try {
      const { row } = record;
      const name = required(row[2], 160), role = required(row[3], 120);
      const sector = required(record.sector, 120);
      const registration = registrationAt(record);
      if (!cell(row[0])) {
        missingRegistrations.push({ line: record.line, name, sector, role, resolved: Boolean(registration) });
        if (!registration) continue;
      } else if (typeof row[0] !== "string" && result.replacement) result.replacement.invalidIdentityRows++;
      required(registration, 60);
      if ((registrationCounts.get(registration) ?? 0) > 1) throw new Error("Matrícula duplicada nesta prévia. Registros não foram unidos pelo nome.");
      if (!record.saturday) throw new Error("Linha de sábado ausente no FPRE136.");
      const classified = classifyFpre136Schedule({ report: "FPRE136", weekday: [row[4], row[6], row[7], row[9]],
        saturday: [record.saturday[1], record.saturday[3], record.saturday[4], record.saturday[6]] });
      const shift = classified.mode === "TIMED" ? parseShift(classified.paidPeriods.join(" / ")) : undefined;
      if (shift && shift.segments.filter((segment) => segment.kind === "WORK").reduce((total, segment) => total + segment.end - segment.start, 0) > 600) throw new Error("Jornada FPRE136 excede 600 minutos de trabalho.");
      if (shift && !shifts.has(shift.id) && shifts.size >= 120) throw new Error("A proposta aceita até 120 horários distintos.");
      const id = `imp-${createHash("sha256").update(`${branchCode}:${registration}`).digest("hex").slice(0, 24)}`;
      result.employees.push({ id, registration, name, sector, role, weeklyHours: options.defaultWeeklyHours, weeklyHoursMode: "BRANCH",
        leadership: inferLeadership({ role, sector }),
        shiftIds: shift ? [shift.id] : [], activeFrom: "", planningEnabled: true, scheduleMode: classified.mode,
        sourceSchedule: { report: "FPRE136", code: required(record.code, 40), description: required(record.description, 180), weekday: classified.weekday, saturday: classified.saturday },
        offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE",
        preferredOffDays: [], historyKnown: false, history: [] });
      if (shift) shifts.set(shift.id, shift);
      if (classified.mode === "MISSING" && result.report) result.report.missingSchedule++;
      for (const message of classified.warnings) result.issues.push({ line: record.line, message });
      if (result.replacement) result.replacement.fieldsById[id] = ["name", "sector", "role", "shiftIds", "scheduleMode", "sourceSchedule"];
    } catch (error) {
      if (result.replacement) result.replacement.rejectedRows++;
      result.issues.push({ line: record.line, message: error instanceof Error ? error.message : "Linha FPRE136 inválida.", rejected: true });
    }
  }
  if (missingRegistrations.length && result.replacement) result.replacement.missingRegistrations = missingRegistrations;
  result.employees = sortEmployees(result.employees.map(applyRestEligibility));
  result.shifts = [...shifts.values()];
  return result;
}
