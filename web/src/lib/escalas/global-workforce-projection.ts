import { canonicalBranchCode } from "./branch-code";
import { applyLocalHolidayCalendar } from "./calendar";
import { addDays } from "./dates";
import { EscalaError } from "./errors";
import { projectEscalaWorkforceDraft, type EscalaWorkforceSnapshot } from "./global-workforce-domain";
import { stableEscalaJson } from "./operational-input-policy";
import { escalaInputSchema } from "./schema";
import { manualShiftAt } from "./shift-catalog/manual-override";
import type { EscalaAssignment, EscalaEmployee, EscalaShift, EscalaWorkspace } from "./types";

type Draft = Pick<EscalaWorkspace, "status" | "input">;
type ManagedEmploymentEnd = { employeeId: string; localActiveUntil: string | null; baseActiveUntil: string };
const keyOf = (entry: Pick<EscalaAssignment, "employeeId" | "date">) => `${entry.employeeId}\0${entry.date}`;
const same = (a: unknown, b: unknown) => stableEscalaJson(a) === stableEscalaJson(b);
const inEmployment = (person: EscalaEmployee, day: string) =>
  person.activeFrom <= day && (!person.activeUntil || day <= person.activeUntil);

function conflict(message: string): never {
  throw new EscalaError(409, "ESCALA_WORKFORCE_DRAFT_CONFLICT", message);
}

function hasContinuity(person: EscalaEmployee) {
  return Boolean(person.history.length || person.planningHistory?.length || person.planningFuture?.length);
}

function earlierEnd(local: string | undefined, base: string | undefined) {
  return local && (!base || local < base) ? local : base;
}

function reconcileShiftIds(old: EscalaEmployee, source: EscalaEmployee,
  localShifts: ReadonlyMap<string, EscalaShift>, sourceShifts: ReadonlyMap<string, EscalaShift>): EscalaEmployee {
  const preferred = [...new Set([...(old.manualShiftBaseIds ?? old.shiftIds), ...(old.originalShiftIds ?? [])])];
  const localId = (id: string) => {
    const incoming = sourceShifts.get(id);
    if (!incoming) conflict("O cadastro exige uma referência de turno não encontrada.");
    const collision = localShifts.get(id);
    if (collision && !same(collision.segments, incoming.segments)) {
      conflict("Um identificador de turno da base já existe no rascunho com outra geometria.");
    }
    // Keep the draft identity when only the external ID differs.
    return preferred.find(candidate => same(localShifts.get(candidate)?.segments, incoming.segments)) ?? id;
  };
  return { ...source,
    shiftIds: [...new Set(source.shiftIds.map(localId))],
    originalShiftIds: source.originalShiftIds && [...new Set(source.originalShiftIds.map(localId))],
    fixedImportedShiftId: source.fixedImportedShiftId && localId(source.fixedImportedShiftId),
  };
}

function mergeExistingPerson(old: EscalaEmployee, source: EscalaEmployee, activeUntil: string | undefined): EscalaEmployee {
  const next = {
    ...old,
    name: source.name,
    sector: source.sector,
    role: source.role,
    activeFrom: source.activeFrom || old.activeFrom,
    activeUntil,
    leadership: old.leadership?.source === "MANUAL" ? old.leadership : source.leadership,
  };
  for (const entry of [...old.history, ...(old.planningHistory ?? []), ...(old.planningFuture ?? [])]) {
    if (inEmployment(old, entry.date) && !inEmployment(next, entry.date)) {
      conflict("A vigência da base conflita com uma decisão de continuidade do rascunho.");
    }
  }

  // A source without an explicit clock reference does not erase a draft's local choice.
  if (!source.sourceSchedule && !source.scheduleMode && !source.shiftIds.length) return next;
  const newIds = source.shiftIds;
  if (old.manualShiftOverrides?.length) {
    const oldBase = old.manualShiftBaseIds ?? old.shiftIds;
    if (!same(oldBase, newIds) || source.scheduleMode && source.scheduleMode !== "TIMED") {
      conflict("A referência da base conflita com um turno escolhido manualmente.");
    }
    return { ...next, sourceSchedule: source.sourceSchedule ?? old.sourceSchedule };
  }
  return {
    ...next,
    shiftIds: newIds,
    originalShiftIds: source.originalShiftIds,
    fixedImportedShiftId: source.fixedImportedShiftId,
    scheduleMode: source.scheduleMode ?? old.scheduleMode,
    sourceSchedule: source.sourceSchedule ?? old.sourceSchedule,
  };
}

function appendReferencedShifts(shifts: EscalaShift[], sources: EscalaShift[], employees: EscalaEmployee[]) {
  const byId = new Map(shifts.map(shift => [shift.id, shift]));
  const referenced = new Set(employees.flatMap(person => [
    ...person.shiftIds, ...(person.originalShiftIds ?? []), ...(person.fixedImportedShiftId ? [person.fixedImportedShiftId] : []),
  ]));
  for (const shift of sources) {
    if (!referenced.has(shift.id)) continue;
    const prior = byId.get(shift.id);
    if (prior && !same(prior.segments, shift.segments)) {
      conflict("Um identificador de turno da base já existe no rascunho com outra geometria.");
    }
    if (!prior) byId.set(shift.id, structuredClone(shift));
  }
  if ([...referenced].some(id => !byId.has(id))) conflict("O cadastro exige uma referência de turno não encontrada.");
  return [...byId.values()];
}

/** Managed keys must come from the server's previous projection, never from client input. */
export function materializeEscalaWorkforceDraft(
  workspace: Draft,
  snapshot: EscalaWorkforceSnapshot,
  previousManagedAbsenceKeys: ReadonlySet<string> = new Set(),
  previousManagedEmploymentEnds: readonly ManagedEmploymentEnd[] = [],
) {
  if (workspace.status !== "DRAFT") {
    throw new EscalaError(409, "ESCALA_WORKFORCE_PUBLISHED", "Reabra a publicação como rascunho antes de sincronizar a base.");
  }
  const input = workspace.input;
  const branch = canonicalBranchCode(input.branchCode);
  if (!snapshot.catalogs.some(catalog => catalog.branchCode === branch)) {
    conflict("A filial não tem uma equipe global confirmada. O rascunho foi preservado.");
  }
  const { employees: sources, shifts: sourceShifts, absenceDates } =
    projectEscalaWorkforceDraft(snapshot, branch, input.startDate, input.endDate);
  const localShiftById = new Map(input.shifts.map(shift => [shift.id, shift]));
  const sourceShiftById = new Map(sourceShifts.map(shift => [shift.id, shift]));
  const oldByRegistration = new Map<string, EscalaEmployee>();
  for (const old of input.employees) {
    if (oldByRegistration.has(old.registration)) conflict("Há mais de um vínculo local para a mesma matrícula.");
    oldByRegistration.set(old.registration, old);
  }
  const sourceByRegistration = new Map(sources.map(person => [person.registration, person]));
  const previousEnds = new Map(previousManagedEmploymentEnds.map(entry => [entry.employeeId, entry]));
  const managedEmploymentEnds: ManagedEmploymentEnd[] = [];
  const employmentEnd = (id: string, local: string | undefined, base: string | undefined) => {
    if (base && (!local || base < local)) managedEmploymentEnds.push({ employeeId: id, localActiveUntil: local ?? null, baseActiveUntil: base });
    return earlierEnd(local, base);
  };
  const employees: EscalaEmployee[] = [];
  for (const old of input.employees) {
    const source = sourceByRegistration.get(old.registration);
    if (!source) {
      if (old.manualShiftOverrides?.length || hasContinuity(old)) {
        conflict("A retirada de um vínculo atingiria um ajuste manual ou registro de continuidade.");
      }
      continue;
    }
    const previous = previousEnds.get(old.id);
    const local = previous && old.activeUntil === previous.baseActiveUntil ? previous.localActiveUntil ?? undefined : old.activeUntil;
    employees.push(mergeExistingPerson(old, reconcileShiftIds(old, source, localShiftById, sourceShiftById),
      employmentEnd(old.id, local, source.activeUntil)));
  }
  for (const source of sources) {
    if (!oldByRegistration.has(source.registration)) {
      employmentEnd(source.id, undefined, source.activeUntil);
      employees.push(structuredClone(source));
    }
  }
  const peopleById = new Map(employees.map(person => [person.id, person]));
  if (peopleById.size !== employees.length) conflict("O identificador global colide com outro vínculo do rascunho.");
  const shifts = appendReferencedShifts(input.shifts, sourceShifts, employees);
  const shiftsById = new Map(shifts.map(shift => [shift.id, shift]));
  const calendar = applyLocalHolidayCalendar(input).policy;
  const closed = new Set(calendar.closedDates);
  const holidays = new Set(calendar.holidayDates);
  const desiredAbsence = new Map<string, EscalaAssignment>();
  for (const person of employees) {
    for (const date of absenceDates.get(person.registration) ?? []) {
      if (!inEmployment(person, date)) continue;
      const entry = { employeeId: person.id, date, kind: "ABSENCE" } as const;
      desiredAbsence.set(keyOf(entry), entry);
    }
  }

  const assignments = new Map<string, EscalaAssignment>();
  const managedAbsenceKeys = new Set<string>();
  for (const entry of input.assignments) {
    const key = keyOf(entry);
    const person = peopleById.get(entry.employeeId);
    const requested = desiredAbsence.delete(key);
    const officialHoliday = entry.kind === "HOLIDAY" && (closed.has(entry.date) || holidays.has(entry.date));
    const ownedAbsence = entry.kind === "ABSENCE" && !entry.locked && !entry.absenceSource && previousManagedAbsenceKeys.has(key);
    if (!person || !inEmployment(person, entry.date)) {
      if (entry.locked || entry.kind === "ABSENCE" && !ownedAbsence || entry.kind === "HOLIDAY" && !officialHoliday) {
        conflict("A vigência da base atingiria um dia bloqueado ou protegido.");
      }
      continue;
    }
    if (ownedAbsence && !requested) continue;
    if (requested && entry.kind === "ABSENCE" && ownedAbsence) managedAbsenceKeys.add(key);
    if (requested && entry.kind !== "ABSENCE" && !officialHoliday) {
      if (entry.locked !== false || entry.kind === "HOLIDAY" || closed.has(entry.date) || manualShiftAt(person, entry.date)) {
        conflict("O afastamento da base conflita com um dia bloqueado, fechamento ou ajuste manual.");
      }
      assignments.set(key, { employeeId: person.id, date: entry.date, kind: "ABSENCE" });
      managedAbsenceKeys.add(key);
      continue;
    }
    if (entry.kind === "WORK") {
      const manual = manualShiftAt(person, entry.date);
      const timed = person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING";
      if (!timed || !entry.shiftId || (manual ? manual !== entry.shiftId : !person.shiftIds.includes(entry.shiftId))) {
        const previousShift = entry.shiftId && localShiftById.get(entry.shiftId);
        const equivalent = timed && !manual && previousShift && person.shiftIds.some(id =>
          same(previousShift.segments, shiftsById.get(id)?.segments));
        if (equivalent && entry.shiftId && person.shiftIds.length < 12) {
          // A protected decision can retain another local ID for the same clock.
          person.shiftIds = [...person.shiftIds, entry.shiftId];
        } else {
          if (entry.locked === false && !manual && !closed.has(entry.date) && !holidays.has(entry.date) &&
            input.generationMode !== "HOURS_ONLY") continue;
          conflict("Uma atribuição existente não é compatível com o turno indicado pela base.");
        }
      }
    }
    assignments.set(key, entry);
  }
  for (const [key, entry] of desiredAbsence) {
    if (closed.has(entry.date)) continue;
    const person = peopleById.get(entry.employeeId);
    if (person && manualShiftAt(person, entry.date)) conflict("O afastamento da base conflita com um ajuste manual.");
    assignments.set(key, entry);
    managedAbsenceKeys.add(key);
  }
  for (const entry of assignments.values()) {
    if (entry.kind !== "WORK" || !entry.shiftId || !shiftsById.get(entry.shiftId)?.segments.some(
      segment => segment.kind !== "BREAK" && segment.end > 1440,
    )) continue;
    const person = peopleById.get(entry.employeeId);
    const nextDate = addDays(entry.date, 1);
    const nextKey = keyOf({ employeeId: entry.employeeId, date: nextDate });
    if (managedAbsenceKeys.has(nextKey) || person?.activeUntil === entry.date) {
      conflict("Um turno existente ultrapassa o início de um afastamento ou desligamento.");
    }
  }

  const nextAssignments = [...assignments.values()];
  const changed = !same(input.employees, employees) || !same(input.shifts, shifts) || !same(input.assignments, nextAssignments);
  if (!changed) return { input, managedAbsenceKeys, managedEmploymentEnds, changed };
  const parsed = escalaInputSchema.safeParse({
    ...input, employees, shifts, assignments: nextAssignments,
    needsRegeneration: true, generationBasis: undefined, coverageBasis: undefined,
  });
  if (!parsed.success) conflict("A base não pode ser aplicada sem revisar as vigências e os ajustes do rascunho.");
  return { input: parsed.data, managedAbsenceKeys, managedEmploymentEnds, changed };
}
