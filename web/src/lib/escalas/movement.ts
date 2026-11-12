import { currentLeadership } from "./leadership";
import type { EscalaEmployee, EscalaInput } from "./types";

const weights = { LOW: 1, NORMAL: 2, HIGH: 3 };

/** Explicit sector settings override branch settings; absence never implies a peak. */
export function movementLevel(input: EscalaInput, sector: string, date: string) {
  const matches = (input.movementPriorities ?? []).filter(priority => priority.startDate <= date && date <= priority.endDate
    && (!priority.sector || priority.sector === sector));
  const specific = matches.filter(priority => priority.sector === sector);
  return (specific.length ? specific : matches).reduce<"LOW" | "NORMAL" | "HIGH" | undefined>((level, priority) =>
    !level || weights[priority.level] > weights[level] ? priority.level : level, undefined);
}

/** A local presence exchange must not remove the last responsible leader on a declared peak day. */
export function keepsPriorityLeader(input: EscalaInput, person: EscalaEmployee, sourceDate: string): boolean {
  const responsibility = currentLeadership(person);
  const critical = responsibility && responsibility.role !== "NONE"
    ? responsibility.sectors.filter(sector => movementLevel(input, sector, sourceDate) === "HIGH") : [];
  return critical.every(sector => input.employees.some(peer => peer.id !== person.id && peer.planningEnabled !== false
    && currentLeadership(peer)?.role !== "NONE"
    && currentLeadership(peer)?.sectors.includes(sector)
    && input.assignments.some(record => record.employeeId === peer.id && record.date === sourceDate
      && (record.kind === "DUTY" || record.kind === "WORK"))));
}
