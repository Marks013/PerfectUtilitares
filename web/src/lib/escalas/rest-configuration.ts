import { canonicalBranchCode } from "./branch-code";
import { addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaIssue } from "./types";

/** Operational instruction for branch 02, independent of holiday or employee settings. */
export function branchClosesOnSunday(input: Pick<EscalaInput, "branchCode">): boolean {
  return canonicalBranchCode(input.branchCode) === "02";
}

/** v3 generation/validation only. Historical revisions and personal settings stay intact. */
export function applyBranchRestCalendar(input: EscalaInput): EscalaInput {
  if ((input.restRulesVersion ?? 1) < 3 || !branchClosesOnSunday(input)) return input;
  // Include civil carry at either edge so a Saturday turn cannot occupy a closed Sunday.
  const sundays = new Set(dateRange(addDays(input.startDate, -1), addDays(input.endDate, 1)).filter(day => dayOfWeek(day) === 6));
  const closedDates = [...new Set([...input.policy.closedDates, ...sundays])].sort();
  const demands = input.demands.filter(item => !(item.estimated === true && sundays.has(item.date)));
  if (JSON.stringify(closedDates) === JSON.stringify(input.policy.closedDates) && demands.length === input.demands.length) return input;
  return { ...input, policy: { ...input.policy, closedDates }, demands };
}

export function variableRestGroups(input: EscalaInput, person: EscalaEmployee,
  baseline: readonly EscalaAssignment[] = input.assignments): string[][][] {
  if ((input.restRulesVersion ?? 1) < 3 || input.generationMode === "HOURS_ONLY"
    || person.planningEnabled === false || person.offMode === "FIXED" || person.offPattern === "CONSECUTIVE") return [];
  const records = new Map(baseline.filter(item => item.employeeId === person.id).map(item => [item.date, item]));
  const holidays = new Set([...input.policy.holidayDates, ...(input.policy.paidHolidayDates ?? [])]);
  const closed = new Set(input.policy.closedDates);
  const weeks = new Map<string, string[]>();
  for (const day of dateRange(input.startDate, input.endDate)) {
    if (day < person.activeFrom || person.activeUntil && day > person.activeUntil) continue;
    const start = weekStart(day, input), days = weeks.get(start) ?? [];
    days.push(day); weeks.set(start, days);
  }
  const comparable = new Map<string, string[][]>();
  const visible = new Set(visibleDates(input));
  for (const days of weeks.values()) {
    // Padding dates retain weekly rules but cannot disguise a fixed visible month.
    if (days.length !== 7 || days.some(day => !visible.has(day))) continue;
    if (days.some(day => holidays.has(day) || records.get(day)?.locked
      || records.get(day)?.kind === "ABSENCE" || records.get(day)?.kind === "HOLIDAY")) continue;
    const imposed = [...new Set([...person.fixedOffDays, ...days.filter(day => closed.has(day)).map(dayOfWeek)])].sort();
    if (imposed.length >= 2) continue;
    const key = imposed.join(","), group = comparable.get(key) ?? [];
    group.push(days); comparable.set(key, group);
  }
  return [...comparable.values()].filter(group => group.length >= 2);
}

/** Independent check: repeated two-day patterns are not silently promoted to fixed arrangements. */
export function variableRestIssues(input: EscalaInput): EscalaIssue[] {
  const byPerson = new Map<string, Map<string, EscalaAssignment>>();
  for (const record of input.assignments) {
    const records = byPerson.get(record.employeeId) ?? new Map<string, EscalaAssignment>();
    records.set(record.date, record); byPerson.set(record.employeeId, records);
  }
  const issues: EscalaIssue[] = [];
  for (const person of input.employees) {
    const records = byPerson.get(person.id);
    if (!records) continue;
    for (const weeks of variableRestGroups(input, person)) {
      if (weeks.some(days => days.some(day => !records.has(day)))) continue;
      const shared = [0, 1, 2, 3, 4, 5, 6].filter(weekday => weeks.every(days =>
        days.some(day => dayOfWeek(day) === weekday && records.get(day)?.kind === "OFF")));
      if (shared.length >= 2) {
        issues.push({ code: "VARIABLE_REST_PATTERN_FIXED", severity: "ERROR", employeeId: person.id,
          date: weeks[0][0], message: "As duas folgas repetem os mesmos dias em todas as semanas comparáveis. Gere uma distribuição variável ou habilite explicitamente os dias fixos no cadastro. Bloqueios, afastamentos e feriados não foram alterados." });
        break;
      }
    }
  }
  return issues;
}
