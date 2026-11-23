import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";
import { addDays, dateRange, isDate } from "./dates";
import { EscalaError } from "./errors";
import { escalaEmployeeSchema, escalaInputSchema } from "./schema";

const date = z.string().refine(isDate, "Informe uma data real no formato AAAA-MM-DD");
const branch = z.string().trim().min(1).max(160).transform(canonicalBranchCode);
const registration = z.string().trim().min(1).max(160);

const personSchema = z.strictObject({
  branchCode: branch,
  // Recorded only by a confirmed transfer. No effective date is inferred from a roster.
  previousBranchCodes: z.array(branch).min(1).max(1_000).optional(),
  employee: escalaEmployeeSchema,
  // The official team no longer lists this identity. This is not a dismissal.
  listed: z.literal(false).optional(),
  // First day outside the employment relationship; never inferred from a missing row.
  dismissedFrom: date.nullable(),
}).superRefine(({ employee, dismissedFrom }, context) => {
  if (employee.activeUntil !== undefined || employee.historyKnown || employee.history.length ||
    employee.planningHistory || employee.planningFuture || employee.manualShiftOverrides ||
    employee.manualShiftBaseIds || employee.manualShiftByDate || employee.simulationDailyMinutes !== undefined) {
    context.addIssue({ code: "custom", path: ["employee"], message: "Dados exclusivos do rascunho não pertencem à base global" });
  }
  if (dismissedFrom && employee.activeFrom && dismissedFrom < employee.activeFrom) {
    context.addIssue({ code: "custom", path: ["dismissedFrom"], message: "Desligamento anterior à admissão" });
  }
});

const absenceSchema = z.strictObject({
  registration,
  startDate: date,
  endDate: date.nullable(),
  source: z.enum(["MANUAL", "FPHI105"]),
}).refine(item => item.endDate === null || item.endDate >= item.startDate, {
  path: ["endDate"], message: "Término anterior ao início do afastamento",
});

type Absence = z.output<typeof absenceSchema>;
type AbsenceKey = Pick<Absence, "registration" | "startDate">;
const absenceKey = (item: AbsenceKey) => JSON.stringify([item.registration, item.startDate]);

export const escalaWorkforceSnapshotSchema = z.strictObject({
  version: z.literal(1),
  sourceCompanyCode: z.string().regex(/^(?:0|[1-9]\d{0,59})$/).optional(),
  people: z.array(personSchema).max(10_000),
  catalogs: z.array(z.strictObject({ branchCode: branch, shifts: escalaInputSchema.shape.shifts })).max(1_000),
  absences: z.array(absenceSchema).max(100_000),
}).superRefine(({ people, catalogs, absences }, context) => {
  const shiftReferences = new Map<string, Set<string>>();
  catalogs.forEach(({ branchCode, shifts }, index) => {
    const ids = new Set(shifts.map(shift => shift.id));
    if (shiftReferences.has(branchCode) || ids.size !== shifts.length) {
      context.addIssue({ code: "custom", path: ["catalogs", index], message: "Filial ou turno duplicado no catálogo" });
    }
    shiftReferences.set(branchCode, ids);
  });

  const registrations = new Set<string>();
  const branchEmployees = new Set<string>();
  people.forEach(({ branchCode, previousBranchCodes, employee }, index) => {
    const id = JSON.stringify([branchCode, employee.id]);
    if (registrations.has(employee.registration) || branchEmployees.has(id)) {
      context.addIssue({ code: "custom", path: ["people", index], message: "Matrícula da empresa ou identificador da filial duplicado" });
    }
    registrations.add(employee.registration);
    branchEmployees.add(id);
    const catalog = shiftReferences.get(branchCode);
    const references = [...employee.shiftIds, ...(employee.originalShiftIds ?? [])];
    if (employee.fixedImportedShiftId) references.push(employee.fixedImportedShiftId);
    if (!catalog || references.some(reference => !catalog.has(reference))) {
      context.addIssue({ code: "custom", path: ["people", index], message: "Catálogo ou turno da filial não encontrado" });
    }
    if (previousBranchCodes && (new Set(previousBranchCodes).size !== previousBranchCodes.length ||
      previousBranchCodes.some(code => code === branchCode || !shiftReferences.has(code)))) {
      context.addIssue({ code: "custom", path: ["people", index, "previousBranchCodes"], message: "Histórico de filiais inconsistente" });
    }
  });

  const events = new Set<string>();
  absences.forEach((item, index) => {
    const key = absenceKey(item);
    if (!registrations.has(item.registration) || events.has(key)) {
      context.addIssue({ code: "custom", path: ["absences", index], message: "Matrícula desconhecida ou afastamento duplicado" });
    }
    events.add(key);
  });
});

export type EscalaWorkforceSnapshot = z.output<typeof escalaWorkforceSnapshotSchema>;

/** The file's Término is inclusive. An open reimport cannot erase a known return. */
export function applyEscalaWorkforceFphi105(
  snapshot: EscalaWorkforceSnapshot,
  records: ReadonlyArray<Omit<Absence, "source">>,
): EscalaWorkforceSnapshot {
  const registrations = new Set(snapshot.people.map(person => person.employee.registration));
  const absences = new Map(snapshot.absences.map(item => [absenceKey(item), item]));
  const incoming = new Map<string, Absence>();
  for (const record of records) {
    const item = absenceSchema.parse({ ...record, source: "FPHI105" });
    if (!registrations.has(item.registration)) {
      throw new EscalaError(422, "ESCALA_WORKFORCE_UNKNOWN_REGISTRATION", "O afastamento não corresponde à matrícula oficial da empresa.");
    }
    const key = absenceKey(item);
    const duplicate = incoming.get(key);
    if (duplicate && duplicate.endDate !== item.endDate) {
      throw new EscalaError(422, "ESCALA_WORKFORCE_CONFLICTING_ABSENCE", "O arquivo informa términos diferentes para o mesmo afastamento.");
    }
    incoming.set(key, item);
  }
  let changed = false;
  for (const [key, item] of incoming) {
    const previous = absences.get(key);
    if (previous && (item.endDate === null || item.endDate === previous.endDate)) continue;
    absences.set(key, item);
    changed = true;
  }
  return changed ? escalaWorkforceSnapshotSchema.parse({ ...snapshot, absences: [...absences.values()] }) : snapshot;
}

/** The manual return date is the first available day, not an absence day. */
export function setEscalaWorkforceReturnDate(
  snapshot: EscalaWorkforceSnapshot, key: AbsenceKey, returnDate: string,
): EscalaWorkforceSnapshot {
  if (!isDate(returnDate) || returnDate <= key.startDate) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_RETURN", "A data de retorno deve ser posterior ao início do afastamento.");
  }
  const id = absenceKey(key);
  const item = snapshot.absences.find(absence => absenceKey(absence) === id);
  if (!item) throw new EscalaError(404, "ESCALA_WORKFORCE_ABSENCE_NOT_FOUND", "Afastamento não encontrado.");
  const endDate = addDays(returnDate, -1);
  if (item.endDate === endDate) return snapshot;
  return { ...snapshot, absences: snapshot.absences.map(absence => absence === item ? { ...item, endDate, source: "MANUAL" } : absence) };
}

/** Separate from return/absence operations; only the dedicated caller can mark dismissal. */
export function dismissEscalaWorkforcePerson(
  snapshot: EscalaWorkforceSnapshot, registration: string, dismissedFrom: string,
): EscalaWorkforceSnapshot {
  const person = snapshot.people.find(item => item.employee.registration === registration);
  if (!person) throw new EscalaError(404, "ESCALA_WORKFORCE_UNKNOWN_REGISTRATION", "Matrícula não encontrada.");
  if (!isDate(dismissedFrom) || dismissedFrom < person.employee.activeFrom) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_DISMISSAL", "O desligamento não pode ser anterior à admissão.");
  }
  if (person.dismissedFrom === dismissedFrom) return snapshot;
  return { ...snapshot, people: snapshot.people.map(item => item === person ? { ...person, dismissedFrom } : item) };
}

/**
 * Read model for a draft, never a published snapshot. Membership uses the current branch:
 * a transfer with no recorded effective date does not invent a historical split.
 * The caller maps official registrations to the draft's own IDs and enforces protected cells.
 */
export function projectEscalaWorkforceDraft(
  snapshot: EscalaWorkforceSnapshot, branchCode: string, startDate: string, endDate: string,
) {
  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate || endDate > addDays(startDate, 41)) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_PERIOD", "O rascunho deve abranger até 42 dias.");
  }
  const branch = canonicalBranchCode(branchCode);
  const people = snapshot.people.filter(person => person.branchCode === branch && person.listed !== false &&
    person.dismissedFrom !== person.employee.activeFrom &&
    person.employee.activeFrom <= endDate && (person.dismissedFrom === null || person.dismissedFrom > startDate));
  const employees = people.map(person => person.dismissedFrom === null
    ? person.employee : { ...person.employee, activeUntil: addDays(person.dismissedFrom, -1) });
  const peopleByRegistration = new Map(employees.map(employee => [employee.registration, employee]));
  const absenceDates = new Map<string, Set<string>>();
  for (const absence of snapshot.absences) {
    const employee = peopleByRegistration.get(absence.registration);
    if (!employee) continue;
    const lower = [startDate, employee.activeFrom, absence.startDate].sort().at(-1) ?? startDate;
    const upper = [endDate, employee.activeUntil ?? endDate, absence.endDate ?? endDate].sort()[0];
    if (lower > upper) continue;
    const dates = absenceDates.get(absence.registration) ?? new Set<string>();
    for (const day of dateRange(lower, upper)) dates.add(day);
    absenceDates.set(absence.registration, dates);
  }
  return { employees, shifts: snapshot.catalogs.find(catalog => catalog.branchCode === branch)?.shifts ?? [], absenceDates };
}
