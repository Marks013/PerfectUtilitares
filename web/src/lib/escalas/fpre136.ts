import { createHash } from "node:crypto";
import { EscalaError } from "./access";
import type { EscalaImportPreview, ImportOptions } from "./import";
import { sortEmployees } from "./order";
import { applyRestEligibility } from "./eligibility";
import type { EscalaShift } from "./types";
import { canonicalBranchCode as normalizeBranch } from "./branch-code";

const cell = (value: unknown) => String(value ?? "").trim();
const sectorPattern = /^(\d{2})\.\d+\s*,\s*([^,]+),\s*(.+)$/;

/** Only this report signature enables heterogeneous records and Windows-1252. */
export function isFpre136Text(text: string) {
  return /^"?Quadro de Hor[áa]rios"?\s*$/mi.test(text)
    && /^"?"?,"?Nome"?,"?Cargo"?,"?Hor[áa]rio"?\s*$/mi.test(text)
    && /^"?\d+"?,"?-"?,.+,"?P[áa]g\.:"?,"?\s*\d+\s*"?\s*$/mi.test(text);
}

export function isFpre136Rows(rows: unknown[][]) {
  return rows.some((row) => cell(row[0]) === "Quadro de Horários")
    && rows.some((row) => cell(row[1]) === "Nome" && cell(row[2]) === "Cargo" && cell(row[3]) === "Horário")
    && rows.some((row) => cell(row[1]) === "-" && cell(row[3]) === "Pág.:");
}

function schedule(times: unknown[]) {
  const values = times.map(cell);
  if (values.some((value) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error("Horário FPRE136 inválido.");
  return `${values[0]}-${values[1]} / ${values[2]}-${values[3]}`;
}

function required(value: unknown, max: number) {
  const text = cell(value);
  if (!text || text.length > max || [...text].some((character) => character.charCodeAt(0) < 32)) throw new Error("Campo obrigatório inválido no FPRE136.");
  return text;
}

export function previewFpre136Rows(rows: unknown[][], options: ImportOptions, parseShift: (value: string) => EscalaShift): EscalaImportPreview {
  if (!options.branchCode?.trim()) throw new EscalaError(400, "ESCALA_IMPORT_BRANCH", "Selecione a filial para importar o FPRE136.");
  const branchCode = normalizeBranch(options.branchCode);
  const selected: { row: unknown[]; line: number; sector: string; code: string; description: string; saturday?: unknown[] }[] = [];
  let context: { branchCode: string; branchName: string; sector: string } | undefined;
  let code = "", description = "", branchName = "", sourceEmployees = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const sector = row.length === 1 ? sectorPattern.exec(cell(row[0])) : null;
    if (sector) {
      context = { branchCode: sector[1], branchName: sector[2].trim(), sector: sector[3].trim() };
      code = ""; description = "";
      if (context.branchCode === branchCode) branchName = context.branchName;
    } else if (cell(row[0]) === "Horário:") {
      code = cell(row[1]); description = cell(row[3]);
    } else if (row.length === 10 && /^\d+$/.test(cell(row[0])) && cell(row[1]) === "-") {
      sourceEmployees++;
      if (!context) throw new EscalaError(400, "ESCALA_IMPORT_LAYOUT", "Funcionário sem contexto de filial e setor no FPRE136.");
      if (context.branchCode !== branchCode) continue;
      selected.push({ row, line: index + 1, sector: context.sector, code, description,
        saturday: cell(rows[index + 1]?.[0]) === "Sábado:" ? rows[index + 1] : undefined });
    }
  }
  if (!branchName || !selected.length) throw new EscalaError(400, "ESCALA_IMPORT_BRANCH", "A filial selecionada não contém colaboradores neste FPRE136.");
  if (selected.length > 250) throw new EscalaError(400, "ESCALA_IMPORT_LIMIT", "A importação aceita até 250 colaboradores da filial por proposta.");
  const result: EscalaImportPreview = { employees: [], shifts: [], issues: [], totalRows: selected.length,
    report: { format: "FPRE136", branchCode, branchName, sourceEmployees, otherBranchesExcluded: sourceEmployees - selected.length, missingSchedule: 0 } };
  const registrations = new Set<string>(), shifts = new Map<string, EscalaShift>();
  for (const record of selected) {
    try {
      const { row } = record;
      const registration = required(row[0], 60), name = required(row[2], 160), role = required(row[3], 120);
      const sector = required(record.sector, 120);
      if (registrations.has(registration)) throw new Error("Matrícula duplicada nesta prévia. Registros não foram unidos pelo nome.");
      const weekday = schedule([row[4], row[6], row[7], row[9]]);
      if (!record.saturday) throw new Error("Linha de sábado ausente no FPRE136.");
      const saturday = schedule([record.saturday[1], record.saturday[3], record.saturday[4], record.saturday[6]]);
      const missing = [row[4], row[6], row[7], row[9]].every((value) => cell(value) === "00:00");
      const paidPeriods = weekday.split(" / ").filter((period) => period !== "00:00-00:00");
      const shift = missing ? undefined : parseShift(paidPeriods.join(" / "));
      if (shift && shift.segments.filter((segment) => segment.kind === "WORK").reduce((total, segment) => total + segment.end - segment.start, 0) > 600) throw new Error("Jornada FPRE136 excede 600 minutos de trabalho.");
      if (shift && !shifts.has(shift.id) && shifts.size >= 120) throw new Error("A proposta aceita até 120 horários distintos.");
      const id = `imp-${createHash("sha256").update(`${branchCode}:${registration}`).digest("hex").slice(0, 24)}`;
      result.employees.push({ id, registration, name, sector, role, weeklyHours: options.defaultWeeklyHours, weeklyHoursMode: "BRANCH",
        shiftIds: shift ? [shift.id] : [], activeFrom: "", planningEnabled: true, scheduleMode: missing ? "MISSING" : "TIMED",
        sourceSchedule: { report: "FPRE136", code: required(record.code, 40), description: required(record.description, 180), weekday, saturday },
        offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE",
        preferredOffDays: [], historyKnown: false, history: [] });
      if (shift) shifts.set(shift.id, shift);
      if (missing && result.report) result.report.missingSchedule++;
      registrations.add(registration);
    } catch (error) { result.issues.push({ line: record.line, message: error instanceof Error ? error.message : "Linha FPRE136 inválida." }); }
  }
  result.employees = sortEmployees(result.employees.map(applyRestEligibility));
  result.shifts = [...shifts.values()];
  return result;
}
