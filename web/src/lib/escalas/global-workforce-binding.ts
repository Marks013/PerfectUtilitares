import type { Prisma } from "@/generated/prisma/client";
import type { EscalaAbsenceCommand } from "./access-contracts";
import { canonicalBranchCode } from "./branch-code";
import { visibleDates } from "./dates";
import { EscalaError } from "./errors";
import { parseWorkforceDraftState, readWorkforceForDraft } from "./global-workforce-draft";
import { projectEscalaWorkforceDraft, type EscalaWorkforceSnapshot } from "./global-workforce-domain";
import { stableEscalaJson } from "./operational-input-policy";
import type { EscalaInput, EscalaWorkspace } from "./types";

const outdated = () => new EscalaError(409, "ESCALA_WORKFORCE_SYNC_REQUIRED", "A base global mudou. Atualize a equipe do rascunho antes de continuar.");

export function checkWorkforceReady(workspace: Pick<EscalaWorkspace, "workforce">) {
  if (workspace.workforce?.needsSync) throw outdated();
}

/** Only local employees with an actual visible absence in the confirmed branch. */
export function openEndedAbsenceEmployeeIds(input: EscalaInput, snapshot: EscalaWorkforceSnapshot): string[] {
  const branch = canonicalBranchCode(input.branchCode);
  const official = new Map(snapshot.people.filter(person => person.branchCode === branch && person.listed !== false)
    .map(person => [person.employee.registration, person]));
  const openStarts = new Map<string, string>();
  for (const event of snapshot.absences) {
    if (event.endDate !== null || !official.has(event.registration)) continue;
    const start = openStarts.get(event.registration);
    if (!start || event.startDate < start) openStarts.set(event.registration, event.startDate);
  }
  if (!openStarts.size) return [];
  const visible = new Set(visibleDates(input));
  const people = new Map(input.employees.map(person => [person.id, person]));
  const hidden = new Set<string>();
  for (const day of input.assignments) {
    if (day.kind !== "ABSENCE" || !visible.has(day.date) || hidden.has(day.employeeId)) continue;
    const person = people.get(day.employeeId);
    if (!person || day.date < person.activeFrom || (person.activeUntil && day.date > person.activeUntil)) continue;
    const start = openStarts.get(person.registration);
    const source = official.get(person.registration);
    if (!start || day.date < start || !source || day.date < source.employee.activeFrom
      || (source.dismissedFrom && day.date >= source.dismissedFrom)) continue;
    hidden.add(day.employeeId);
  }
  return [...hidden].sort();
}

function removableLegacyDays(input: EscalaInput, state: NonNullable<ReturnType<typeof parseWorkforceDraftState>>,
  snapshot: EscalaWorkforceSnapshot): [string, string][] {
  const candidates = input.assignments.filter(day => day.kind === "ABSENCE" && !day.locked);
  if (!candidates.length) return [];
  const days = new Set(visibleDates(input));
  const owned = new Set(state.managedAbsenceKeys.map(pair => JSON.stringify(pair)));
  const registrations = new Map(input.employees.map(person => [person.id, person.registration]));
  const { absenceDates } = projectEscalaWorkforceDraft(snapshot, input.branchCode, input.startDate, input.endDate);
  return candidates.filter(day => days.has(day.date) && !owned.has(JSON.stringify([day.employeeId, day.date]))
    && !absenceDates.get(registrations.get(day.employeeId) ?? "")?.has(day.date)).map(day => [day.employeeId, day.date]);
}

export async function workforceDraftInfo(tx: Prisma.TransactionClient, tenantId: string, input: EscalaInput, stored: unknown): Promise<EscalaWorkspace["workforce"]> {
  const base = await readWorkforceForDraft(tx, tenantId, input.branchCode);
  if (!base) return undefined;
  const state = parseWorkforceDraftState(stored);
  if (state?.baseRevision !== base.revision) return { needsSync: true };
  const hidden = openEndedAbsenceEmployeeIds(input, base.snapshot);
  return { needsSync: false, legacyAbsenceDays: removableLegacyDays(input, state, base.snapshot),
    ...(hidden.length ? { openEndedAbsenceEmployeeIds: hidden } : {}) };
}

export function carryWorkforceState(input: EscalaInput, stored: unknown) {
  const state = parseWorkforceDraftState(stored);
  if (!state) return null;
  const people = new Set(input.employees.map(person => person.id));
  return { ...state,
    managedAbsenceKeys: state.managedAbsenceKeys.filter(([id, date]) => people.has(id) && date >= input.startDate && date <= input.endDate),
    managedEmploymentEnds: state.managedEmploymentEnds.filter(end => people.has(end.employeeId)),
  };
}

export async function checkWorkforceWrite(tx: Prisma.TransactionClient, tenantId: string,
  workspace: Pick<EscalaWorkspace, "id" | "revision" | "status" | "input">, next?: EscalaInput,
  options: { legacyTeamWrite?: boolean; absenceCommand?: EscalaAbsenceCommand } = {}) {
  if (workspace.status !== "DRAFT") return;
  const base = await readWorkforceForDraft(tx, tenantId, workspace.input.branchCode);
  if (!base) return;
  const row = await tx.escalaWorkspace.findFirst({
    where: { tenantId, id: workspace.id, revision: workspace.revision, status: "DRAFT" },
    select: { workforceState: true },
  });
  const state = parseWorkforceDraftState(row?.workforceState);
  if (!state || state.baseRevision !== base.revision) throw outdated();
  if (!next) return base;
  const person = (input: EscalaInput) => input.employees.map(({ id, registration, name, sector, role, activeFrom, activeUntil }) =>
    [id, registration, name, sector, role, activeFrom, activeUntil]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const absence = (input: EscalaInput) => input.assignments.filter(day => day.kind === "ABSENCE")
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  const command = options.absenceCommand;
  const removable = command?.action === "REMOVE_ABSENCE"
    ? new Set(removableLegacyDays(workspace.input, state, base.snapshot).map(pair => JSON.stringify(pair))) : new Set<string>();
  const expected = absence(workspace.input).filter(day => !(command && day.employeeId === command.employeeId &&
    day.date >= command.startDate && day.date <= command.endDate && removable.has(JSON.stringify([day.employeeId, day.date]))));
  if (options.legacyTeamWrite || command?.action === "ADD_ABSENCE" || stableEscalaJson(person(workspace.input)) !== stableEscalaJson(person(next)) ||
    stableEscalaJson(expected) !== stableEscalaJson(absence(next))) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_MANAGED", "Atualize cadastros, admissões e afastamentos na base global da filial.");
  }
  return base;
}
