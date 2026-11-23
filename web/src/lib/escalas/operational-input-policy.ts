import { applyLocalHolidayCalendar, closedHolidayDates } from "./calendar";
import { EscalaError } from "./errors";
import type { EscalaCapability } from "./permissions";
import type { EscalaInput } from "./types";

export function stableEscalaJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableEscalaJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${stableEscalaJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => stableEscalaJson(a) === stableEscalaJson(b);
const forbidden = () => { throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "A alteração contém campos administrativos ou registros protegidos. Os dados foram preservados."); };

function onlyUpdatesUnlockedWorkShifts(previous: EscalaInput["assignments"], next: EscalaInput["assignments"]) {
  return previous.length === next.length && previous.every((old, index) => {
    const updated = next[index];
    return same(old, updated) || (
      old.kind === "WORK" && old.locked === false && Boolean(old.shiftId && updated.shiftId)
      && same({ ...old, shiftId: updated.shiftId }, updated)
    );
  });
}

/** Preservation check independent of permission to apply; generation previews must also preserve these records. */
export function assertEscalaProtectedAssignments(previous: EscalaInput, next: EscalaInput,
  trustedProposal = false, allowExplicitUnlock = false) {
  const key = (entry: { employeeId: string; date: string }) => `${entry.employeeId}\0${entry.date}`;
  const previousAssignments = new Map(previous.assignments.map(entry => [key(entry), entry]));
  const nextAssignments = new Map(next.assignments.map(entry => [key(entry), entry]));
  const unlock = (old: EscalaInput["assignments"][number] | undefined, entry: EscalaInput["assignments"][number] | undefined) =>
    allowExplicitUnlock && old?.locked === true && entry?.locked === false
      && old.kind !== "ABSENCE" && old.kind !== "HOLIDAY" && same({ ...old, locked: false }, entry);
  for (const entry of previous.assignments) {
    if (entry.locked !== false || entry.kind === "ABSENCE" || entry.kind === "HOLIDAY") {
      if (!same(entry, nextAssignments.get(key(entry))) && !unlock(entry, nextAssignments.get(key(entry)))) forbidden();
    }
  }
  let trustedHolidays: Set<string> | undefined;
  for (const entry of next.assignments) {
    const old = previousAssignments.get(key(entry));
    if (!old && trustedProposal && entry.kind === "HOLIDAY") {
      // A signed proposal may project server-derived store closures. Never use
      // holiday data from the candidate to authorize a previously unknown date.
      trustedHolidays ??= new Set([...previous.policy.holidayDates, ...closedHolidayDates(applyLocalHolidayCalendar(previous))]);
      if (trustedHolidays.has(entry.date)) continue;
    }
    const changedLock = old ? entry.locked !== old.locked : entry.locked !== false;
    if ((entry.kind === "ABSENCE" || entry.kind === "HOLIDAY" || changedLock) && !same(old, entry) && !unlock(old, entry)) forbidden();
  }
}

/** Compare parsed raw input. Returns whether personal rest edits require a transactional grant check. */
export function assertEscalaOperationalInput(previous: EscalaInput, next: EscalaInput,
  capabilities: readonly EscalaCapability[], trustedProposal = false, catalogIntent = false, allowExplicitUnlock = false) {
  const has = (capability: EscalaCapability) => capabilities.includes(capability);
  assertEscalaProtectedAssignments(previous, next, trustedProposal, allowExplicitUnlock);
  if (!same(previous.assignments, next.assignments) && !has("schedule.apply")) {
    // The catalog service computes the dated swap after checking the approved clock and preview.
    if (!catalogIntent || !has("shift.manage") || !has("workspace.save")
      || !onlyUpdatesUnlockedWorkShifts(previous.assignments, next.assignments)) forbidden();
  }
  if (trustedProposal) return false;
  const rootExceptions = new Set(["employees", "assignments", ...(catalogIntent ? ["shifts"] : [])]);
  for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!rootExceptions.has(field) && !same(previous[field as keyof EscalaInput], next[field as keyof EscalaInput])) forbidden();
  }
  if (previous.employees.length !== next.employees.length) forbidden();
  const oldById = new Map(previous.employees.map(person => [person.id, person]));
  let fixedRestChanged = false;
  for (const person of next.employees) {
    const old = oldById.get(person.id);
    if (!old) forbidden();
    for (const field of new Set([...Object.keys(old ?? {}), ...Object.keys(person)])) {
      if (same(old?.[field as keyof typeof person], person[field as keyof typeof person])) continue;
      if ((field === "name" || field === "preferredOffDays") && has("employee.manage")) continue;
      if ((field === "offMode" || field === "fixedOffDays" || field === "fixedRestSlots")
        && previous.generationMode !== "HOURS_ONLY" && has("employee.manage")) {
        fixedRestChanged = true;
        continue;
      }
      if (catalogIntent && has("shift.manage") && ["manualShiftOverrides", "manualShiftBaseIds", "manualShiftByDate", "shiftIds"].includes(field)) continue;
      forbidden();
    }
  }
  const people = new Map(next.employees.map(person => [person.id, person]));
  for (const assignment of next.assignments) {
    if (assignment.kind !== "WORK") continue;
    const person = people.get(assignment.employeeId);
    if (!person || !(person.shiftIds.includes(assignment.shiftId ?? "")
      || person.manualShiftByDate?.[assignment.date] === assignment.shiftId)) forbidden();
  }
  return fixedRestChanged;
}
