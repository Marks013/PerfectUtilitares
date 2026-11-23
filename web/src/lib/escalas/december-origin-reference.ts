import { canUpgradePlanningCalendar, sundayCalendarDraft } from "./calendar-upgrade";
import { operationalEscalaInput } from "./eligibility";
import { EscalaError } from "./errors";
import { effectiveScheduleMode } from "./fpre136-schedule";
import { effectiveWorkDayLimit } from "./labor-rules";
import { stableEscalaJson } from "./operational-input-policy";
import { isDecember2026Cutover } from "./planning-calendar";
import { completeRoster, sameCoverageScenario } from "./roster-quality";
import { materializeManualShiftOverrides } from "./shift-catalog/manual-override";
import type { EscalaInput } from "./types";

const sorted = (rows: readonly unknown[]) => rows.map(stableEscalaJson).sort();
const explicit = (input: EscalaInput) => input.demands.filter(demand => demand.estimated !== true);

function draftDefinition(input: EscalaInput) {
  const { needsRegeneration: _stale, coverageBasis: _coverage, generationBasis: _generation, branchName: _label, ...draft } = input;
  return stableEscalaJson({ ...draft, demands: sorted(explicit(input)), assignments: sorted(draft.assignments),
    employees: sorted(draft.employees.map(({ name: _name, planningHistory: _past, planningFuture: _future, ...person }) => person)),
    shifts: sorted(draft.shifts.map(({ name: _name, ...shift }) => shift)),
  });
}

function protectedDays(input: EscalaInput) {
  const clocks = new Map(input.shifts.map(shift => [shift.id, shift.segments]));
  return stableEscalaJson(sorted(input.assignments.filter(day => day.locked || day.kind === "ABSENCE" || day.kind === "HOLIDAY")
    .map(day => [day, clocks.get(day.shiftId ?? "") ?? null])));
}

/** Reconstruct the exact authorized conversion from the server-loaded immutable revision. */
export function admitDecemberOriginReference(source: EscalaInput, saved: EscalaInput, prepared: EscalaInput): EscalaInput | undefined {
  const origin = saved.planningCalendarSource;
  if (!origin || !isDecember2026Cutover(saved) || !isDecember2026Cutover(prepared) || source.needsRegeneration
    || source.branchCode !== saved.branchCode || source.startDate > saved.startDate || source.endDate < saved.endDate
    || !canUpgradePlanningCalendar(source)) return undefined;
  const inside = (date: string) => date >= saved.startDate && date <= saved.endDate;
  let expected: EscalaInput;
  try {
    expected = materializeManualShiftOverrides(sundayCalendarDraft(source, origin));
  } catch (error) {
    if (error instanceof EscalaError) return undefined;
    throw error;
  }
  if (!isDecember2026Cutover(expected) || draftDefinition(expected) !== draftDefinition(saved)) return undefined;

  const sourceDraft = operationalEscalaInput(expected), context = operationalEscalaInput(prepared);
  const policyForComparison = ({ policy }: EscalaInput) => ({
    ...policy, maxConsecutiveWorkDays: effectiveWorkDayLimit(policy),
    closedDates: policy.closedDates.filter(inside).sort(), holidayDates: policy.holidayDates.filter(inside).sort(),
    paidHolidayDates: (policy.paidHolidayDates ?? []).filter(inside).sort(),
    authorizedHolidayDates: policy.authorizedHolidayDates.filter(inside).sort(),
    calendarProvenance: undefined, coverageReview: undefined,
  });
  if (stableEscalaJson(policyForComparison(sourceDraft)) !== stableEscalaJson(policyForComparison(context))
    || stableEscalaJson(sorted(explicit(sourceDraft))) !== stableEscalaJson(sorted(explicit(context)))
    || protectedDays(sourceDraft) !== protectedDays(context)) return undefined;

  const people = new Map(context.employees.map(person => [person.id, person]));
  const reference = operationalEscalaInput({
    ...sourceDraft, policy: context.policy, simulation: context.simulation, restRulesVersion: context.restRulesVersion,
    employees: sourceDraft.employees.map(person => ({
      ...person, scheduleMode: effectiveScheduleMode(person),
      // The preparer fills in a missing mode. Recognize the bookkeeping only
      // after checking the raw converted draft and the effective dated workloads.
      weeklyHoursMode: person.weeklyHoursMode ?? people.get(person.id)?.weeklyHoursMode,
    })),
    demands: source.demands.filter(demand => inside(demand.date)),
    // Keep provenance from the source. Its fingerprint was for the old horizon.
    coverageBasis: source.coverageBasis,
  });
  if (!reference.demands.some(demand => demand.estimated === true) || !reference.assignments.length
    || !sameCoverageScenario(reference, context) || !completeRoster(reference)) return undefined;
  return reference;
}
