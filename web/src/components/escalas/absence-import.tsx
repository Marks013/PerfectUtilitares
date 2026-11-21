"use client";

import { ImportReplacement, type ImportReplacementProps } from "./import-replacement";
import type { EscalaAssignment, EscalaInput } from "@/lib/escalas/types";

/** Only context that determines the interpretation of this file belongs in the preview identity. */
export function absenceScenarioKey(input: EscalaInput) {
  return JSON.stringify([input.branchCode, input.startDate, input.endDate, input.visibleMonth, input.planningWeekStartsOn, input.defaultWeeklyHours,
    input.employees.map((person) => [person.id, person.registration, person.activeFrom, person.activeUntil, person.planningEnabled])]);
}

export function absencePeriods(assignments: EscalaAssignment[]) {
  const sorted = [...assignments].filter((item) => item.kind === "ABSENCE").sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  const periods: { employeeId: string; startDate: string; endDate: string }[] = [];
  for (const item of sorted) {
    const previous = periods.at(-1);
    if (previous?.employeeId === item.employeeId && item.date === previous.endDate) continue;
    if (previous?.employeeId === item.employeeId && Date.parse(item.date) - Date.parse(previous.endDate) === 86_400_000) previous.endDate = item.date;
    else periods.push({ employeeId: item.employeeId, startDate: item.date, endDate: item.date });
  }
  return periods;
}

export function AbsenceImport(props: ImportReplacementProps) {
  return <ImportReplacement {...props} purpose="ABSENCES" />;
}
