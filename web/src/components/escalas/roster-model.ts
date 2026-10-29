import { addDays, isDate } from "@/lib/escalas/dates";
import type { EscalaAssignment, EscalaInput, EscalaIssue } from "@/lib/escalas/types";
import { validateEscala } from "@/lib/escalas/validation";
import { validateCoverage, workJourney } from "@/lib/escalas/validation-time";

export type RosterDay = { employeeId: string; date: string };
export type RosterCoverageIssue = EscalaIssue & { sector: string };
const key = (day: RosterDay) => `${day.employeeId}:${day.date}`;

/** A metadata stamp does not invalidate undo; saved, reloaded or otherwise edited definitions do. */
export function isCurrentRosterChange(applied: EscalaInput, current: EscalaInput): boolean {
  if (applied.assignments !== current.assignments) return false;
  const fields = Object.keys({ ...applied, ...current }) as (keyof EscalaInput)[];
  return fields.every((field) => field === "needsRegeneration" || applied[field] === current[field]);
}

/** A confirmed edit never changes another cell or bypasses a previously locked decision. */
export function applyRosterChanges(input: EscalaInput, changes: EscalaAssignment[], canUnlock = false): EscalaInput {
  const assignments = new Map(input.assignments.map((day) => [key(day), day]));
  const employees = new Map(input.employees.map((person) => [person.id, person]));
  for (const next of changes) {
    const person = employees.get(next.employeeId);
    if (!person || person.planningEnabled === false) throw new Error("Selecione um colaborador incluído no planejamento.");
    if (!isDate(next.date) || next.date < input.startDate || next.date > input.endDate
      || (person.activeFrom && next.date < person.activeFrom) || (person.activeUntil && next.date > person.activeUntil)) {
      throw new Error("O dia precisa pertencer ao período de planejamento e ao vínculo do colaborador.");
    }
    const previous = assignments.get(key(next));
    if (previous?.locked && (previous.kind !== next.kind || previous.shiftId !== next.shiftId
      || (!next.locked && !canUnlock))) {
      throw new Error("Esta decisão está bloqueada. Um aprovador precisa desbloqueá-la e salvar antes de alterar o dia.");
    }
    const untimed = person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
    if (untimed && next.kind === "WORK") throw new Error("Colaborador sem horário definido: planeje presença diária sem atribuir horas fictícias.");
    if (!untimed && next.kind === "DUTY") throw new Error("Selecione um horário permitido para este colaborador.");
    if (next.kind === "WORK" && (!next.shiftId || !person.shiftIds.includes(next.shiftId))) {
      throw new Error("A troca exige um horário permitido para o colaborador de destino. Escolha outro turno ou ajuste as alternativas da equipe.");
    }
    assignments.set(key(next), { ...next, ...(next.kind === "WORK" ? {} : { shiftId: undefined }) });
  }
  return { ...input, assignments: [...assignments.values()] };
}

/** Both directions are checked before a swap is applied; no partial exchange is possible. */
export function swapRosterDays(input: EscalaInput, first: RosterDay, second: RosterDay): EscalaInput {
  if (key(first) === key(second)) throw new Error("Escolha outro colaborador ou outra data para trocar.");
  const assignments = new Map(input.assignments.map((day) => [key(day), day]));
  const before = assignments.get(key(first));
  const after = assignments.get(key(second));
  if (!before || !after) throw new Error("Defina os dois dias antes de realizar a troca.");
  if (before.kind === "ABSENCE" || after.kind === "ABSENCE") throw new Error("Ausências não são transferidas entre colaboradores. Ajuste a informação individualmente quando houver correção real.");
  if (before.locked || after.locked) throw new Error("Uma das decisões está bloqueada. Desbloqueie e salve antes de trocar.");
  return applyRosterChanges(input, [
    { ...after, ...first, locked: true },
    { ...before, ...second, locked: true },
  ]);
}

/** Check only relevant dates/sectors while retaining every colleague who can cover those intervals. */
export function rosterCoverageIssues(input: EscalaInput, dates: string[], sector?: string): RosterCoverageIssue[] {
  const days = new Set(dates);
  const demands = input.demands.filter((demand) => days.has(demand.date) && (!sector || demand.sector === sector));
  if (!demands.length) return [];
  const starts = new Set(dates.flatMap((day) => [addDays(day, -1), day]));
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const people = new Map(input.employees.map((person) => [person.id, person]));
  const records = new Map(input.employees.flatMap((person) => [
    ...(person.planningHistory ?? []), ...person.history,
  ]).concat(input.assignments).map((day) => [key(day), day]));
  const journeys = [...records.values()].flatMap((day) => {
    const person = people.get(day.employeeId);
    if (day.kind !== "WORK" || !starts.has(day.date) || person?.planningEnabled === false
      || person?.scheduleMode === "UNTIMED" || person?.scheduleMode === "MISSING") return [];
    const shift = shifts.get(day.shiftId ?? "");
    return shift ? [workJourney(day, shift)] : [];
  });
  return [...new Set(demands.map((demand) => demand.sector))].flatMap((value) =>
    validateCoverage({ ...input, demands: demands.filter((demand) => demand.sector === value) }, journeys).issues
      .filter((issue) => issue.code === "COVERAGE_DEFICIT" || issue.code === "ESTIMATED_COVERAGE_GAP")
      .map((issue) => ({ ...issue, sector: value })),
  );
}

function relevantIssues(input: EscalaInput, employeeIds: Set<string>, dates: string[], sectors: Set<string>) {
  const local = { ...input, employees: input.employees.filter((person) => employeeIds.has(person.id)),
    assignments: input.assignments.filter((day) => employeeIds.has(day.employeeId)), demands: [] };
  const employeeIssues = validateEscala(local).issues.filter((issue) => issue.employeeId || issue.code === "INPUT_INVALID");
  const coverageIssues = rosterCoverageIssues(input, dates).filter((issue) => sectors.has(issue.sector));
  return { issues: [...employeeIssues, ...coverageIssues], coverageIssues };
}

/** Revalidate affected employees across week/month boundaries and their exact coverage intervals, not the whole branch. */
export function inspectRosterChanges(previous: EscalaInput, next: EscalaInput) {
  const before = new Map(previous.assignments.map((day) => [key(day), day]));
  const changed = next.assignments.filter((day) => {
    const old = before.get(key(day));
    return old?.kind !== day.kind || old?.shiftId !== day.shiftId || Boolean(old?.locked) !== Boolean(day.locked);
  });
  const employeeIds = new Set(changed.map((day) => day.employeeId));
  const dates = [...new Set(changed.flatMap((day) => [day.date, addDays(day.date, 1)]))];
  const sectors = new Set(next.employees.filter((person) => employeeIds.has(person.id)).map((person) => person.sector));
  const baseline = relevantIssues(previous, employeeIds, dates, sectors);
  const result = relevantIssues(next, employeeIds, dates, sectors);
  const issueKey = (issue: EscalaIssue) => `${issue.code}:${issue.employeeId ?? ""}:${issue.date ?? ""}:${issue.message}`;
  const existingErrors = new Set(baseline.issues.filter((issue) => issue.severity === "ERROR").map(issueKey));
  return { ...result, changedDays: changed.length,
    newErrors: result.issues.filter((issue) => issue.severity === "ERROR" && !existingErrors.has(issueKey(issue))) };
}
