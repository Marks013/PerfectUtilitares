import type { EscalaAssignment } from "./types";

/** Applying a preview never removes existing absences or unlocks manual decisions. */
export function mergeAbsenceAssignments(existing: EscalaAssignment[], incoming: EscalaAssignment[]) {
  const byDay = new Map<string, EscalaAssignment[]>();
  for (const item of existing) {
    const key = `${item.employeeId}:${item.date}`;
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const accepted = new Map<string, EscalaAssignment>();
  const conflictKeys = new Set<string>();
  const conflicts: { employeeId: string; date: string }[] = [];
  for (const item of incoming) {
    if (item.kind !== "ABSENCE") continue;
    const key = `${item.employeeId}:${item.date}`;
    if (accepted.has(key) || conflictKeys.has(key)) continue;
    const previous = byDay.get(key) ?? [];
    if (previous.some((value) => value.kind === "ABSENCE")) continue;
    if (previous.some((value) => value.locked)) {
      conflicts.push({ employeeId: item.employeeId, date: item.date }); conflictKeys.add(key); continue;
    }
    accepted.set(key, { employeeId: item.employeeId, date: item.date, kind: "ABSENCE" });
  }
  return { assignments: [...existing.filter((item) => !accepted.has(`${item.employeeId}:${item.date}`)), ...accepted.values()], conflicts };
}
