import { canonicalBranchCode } from "./branch-code";
import { EscalaError } from "./errors";
import { type EscalaWorkforceSnapshot, escalaWorkforceSnapshotSchema } from "./global-workforce-domain";
import type { EscalaImportPreview } from "./import";
import { stableEscalaJson } from "./operational-input-policy";

type WorkforcePerson = EscalaWorkforceSnapshot["people"][number];
type BranchCatalog = EscalaWorkforceSnapshot["catalogs"][number];
type SourceRow = EscalaImportPreview["employees"][number];

function reject(message: string): never {
  throw new EscalaError(422, "ESCALA_WORKFORCE_INCOMPLETE_TEAM", message);
}

function confirmBatch(previews: readonly EscalaImportPreview[], confirmedBranchCodes: readonly string[]) {
  const confirmed = new Set(confirmedBranchCodes.map(canonicalBranchCode));
  if (!previews.length || confirmed.has("") || confirmed.size !== confirmedBranchCodes.length || confirmed.size !== previews.length) {
    reject("Confirme as filiais cobertas pelo arquivo completo da equipe.");
  }
  const branches = new Map<string, EscalaImportPreview>();
  const employees = new Map<string, { branchCode: string; source: SourceRow }>();
  const sourceEmployees = previews[0].report?.sourceEmployees;
  for (const preview of previews) {
    const report = preview.report;
    const coverage = preview.replacement;
    const branchCode = canonicalBranchCode(report?.branchCode ?? "");
    if (report?.format !== "FPRE136" || !confirmed.has(branchCode) || branches.has(branchCode) ||
      !coverage || coverage.rejectedRows || coverage.invalidIdentityRows || coverage.paginationIssues?.length ||
      coverage.missingRegistrations?.some(row => !row.resolved) || preview.issues.some(issue => issue.rejected) ||
      preview.totalRows !== preview.employees.length ||
      new Set(preview.shifts.map(shift => shift.id)).size !== preview.shifts.length ||
      sourceEmployees !== report.sourceEmployees || report.otherBranchesExcluded !== report.sourceEmployees - preview.totalRows) {
      reject("A equipe contém uma prévia incompleta, divergente ou sem confirmação. Nenhuma filial foi alterada.");
    }
    for (const source of preview.employees) {
      if (!/^\d{1,60}$/.test(source.registration) || employees.has(source.registration) ||
        source.sourceSchedule?.report !== "FPRE136") {
        reject("Há matrícula inválida, repetida ou sem referência oficial no arquivo completo.");
      }
      employees.set(source.registration, { branchCode, source });
    }
    branches.set(branchCode, preview);
  }
  if (employees.size !== sourceEmployees) {
    reject("Não foi possível conferir toda a cobertura das filiais do arquivo.");
  }
  return { branches, employees };
}

function updateExisting(
  previous: WorkforcePerson, { branchCode, source }: { branchCode: string; source: SourceRow },
): WorkforcePerson {
  const employee = previous.employee;
  const previousBranchCodes = branchCode === previous.branchCode ? previous.previousBranchCodes
    : [...new Set([...(previous.previousBranchCodes ?? []), previous.branchCode])].filter(code => code !== branchCode).sort();
  // Keep the official identity and inherited policy. The file only updates the supplied team data.
  return {
    branchCode,
    ...(previousBranchCodes?.length ? { previousBranchCodes } : {}),
    dismissedFrom: previous.dismissedFrom,
    employee: {
      ...employee,
      name: source.name,
      sector: source.sector,
      role: source.role,
      ...(employee.weeklyHoursMode === "INDIVIDUAL" ? {} : { weeklyHours: source.weeklyHours }),
      leadership: branchCode === previous.branchCode && employee.leadership?.source === "MANUAL" ? employee.leadership : source.leadership,
      shiftIds: source.shiftIds,
      originalShiftIds: undefined,
      fixedImportedShiftId: undefined,
      scheduleMode: source.scheduleMode,
      sourceSchedule: source.sourceSchedule,
      planningEnabled: employee.planningEnabled === false && !employee.planningExclusionReason ? false : source.planningEnabled,
      planningExclusionReason: source.planningExclusionReason,
    },
  };
}

function updateCatalog(branchCode: string, old: BranchCatalog | undefined, preview: EscalaImportPreview): BranchCatalog {
  const shifts = new Map(old?.shifts.map(shift => [shift.id, shift]));
  for (const shift of preview.shifts) {
    const current = shifts.get(shift.id);
    if (current && stableEscalaJson(current.segments) !== stableEscalaJson(shift.segments)) {
      reject("Um turno oficial tem marcações diferentes de outro turno com o mesmo identificador.");
    }
    if (!current) shifts.set(shift.id, shift);
  }
  return { branchCode, shifts: [...shifts.values()] };
}

/**
 * A batch consists of server-generated previews of one file, already confirmed by the administrator.
 * The caller owns file identity and CAS checks. Current assignments are never changed here.
 */
export function applyEscalaWorkforceFpre136(
  snapshot: EscalaWorkforceSnapshot, previews: readonly EscalaImportPreview[], confirmedBranchCodes: readonly string[],
): EscalaWorkforceSnapshot {
  const { branches, employees } = confirmBatch(previews, confirmedBranchCodes);
  // A stripped zero is a conflict, not permission to create a second identity or to rename the first.
  const byNumber = new Map<string, string>();
  for (const value of [...snapshot.people.map(person => person.employee.registration), ...employees.keys()]) {
    if (!/^\d+$/.test(value)) continue;
    const numeric = value.replace(/^0+(?=\d)/, "");
    const prior = byNumber.get(numeric);
    if (prior !== undefined && prior !== value && (employees.has(prior) || employees.has(value))) {
      reject("Há matrículas diferentes apenas pelos zeros à esquerda. Confira o código oficial.");
    }
    byNumber.set(numeric, value);
  }
  const people = snapshot.people.map(person => {
    const target = employees.get(person.employee.registration);
    if (!target) {
      return branches.has(person.branchCode) && person.listed !== false ? { ...person, listed: false as const } : person;
    }
    if (person.branchCode !== target.branchCode && !branches.has(person.branchCode)) {
      reject("A transferência exige cobertura confirmada da origem e do destino no mesmo arquivo.");
    }
    employees.delete(person.employee.registration);
    return updateExisting(person, target);
  });
  for (const { branchCode, source } of employees.values()) {
    const employee = escalaWorkforceSnapshotSchema.shape.people.element.shape.employee.safeParse(source);
    if (!employee.success) reject("Há campo de colaborador incompatível com a equipe global.");
    people.push({ branchCode, employee: employee.data, dismissedFrom: null });
  }
  const catalogs = new Map(snapshot.catalogs.map(catalog => [catalog.branchCode, catalog]));
  for (const [branchCode, preview] of branches) {
    catalogs.set(branchCode, updateCatalog(branchCode, catalogs.get(branchCode), preview));
  }
  const next = escalaWorkforceSnapshotSchema.safeParse({ ...snapshot, people, catalogs: [...catalogs.values()] });
  if (!next.success) reject("O lote contém cadastros ou referências incompatíveis com a base global.");
  return stableEscalaJson(next.data) === stableEscalaJson(snapshot) ? snapshot : next.data;
}
