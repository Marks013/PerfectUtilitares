import { buildCoveragePresence, coverageTimeline } from "./coverage-presence";
import { dateRange } from "./dates";
import { isEscalaPlanningParticipant } from "./eligibility";
import { effectiveScheduleMode } from "./fpre136-schedule";
import { isDecember2026Cutover } from "./planning-calendar";
import { storeClosingMinutes } from "./store-hours";
import type { EscalaGenerationConflict, EscalaInput } from "./types";

const FIRST = "2026-12-01", LAST = "2026-12-05";
const key = (sector: string, role: string) => JSON.stringify([sector, role]);
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}h${String(minutes % 60).padStart(2, "0")}`;
type Band = { start: number; end: number; protectedDays: number };

function capacityByRole(context: EscalaInput) {
  const absence = new Set(context.assignments.filter(row => row.kind === "ABSENCE"
    && row.date >= FIRST && row.date <= LAST).map(row => row.employeeId));
  const counts = new Map<string, number>();
  for (const person of context.employees) {
    const mode = effectiveScheduleMode(person);
    if (!isEscalaPlanningParticipant(person) || mode === "UNTIMED" || mode === "MISSING") continue;
    const scope = key(person.sector, person.role);
    // Give partial availability and absences all five days: a deliberately generous ceiling.
    const cap = person.activeFrom <= FIRST && (!person.activeUntil || person.activeUntil >= LAST)
      && !absence.has(person.id) ? 3 : 5;
    counts.set(scope, (counts.get(scope) ?? 0) + cap);
  }
  return counts;
}

function protectedByRole(origin: EscalaInput) {
  const demands = origin.demands.filter(row => row.estimated === true && row.role && row.minimum > 0
    && row.date >= FIRST && row.date <= LAST && row.start >= 0 && row.end <= 1440
    && !origin.policy.closedDates.includes(row.date));
  const presence = buildCoveragePresence(origin);
  const events = new Map<string, Map<number, number>>();
  for (const date of dateRange(FIRST, LAST)) {
    const dated = demands.filter(row => row.date === date);
    for (const sector of new Set(dated.map(row => row.sector))) {
      const rows = dated.filter(row => row.sector === sector);
      for (const { start, end, people } of coverageTimeline({ ...origin, demands: rows }, date, sector, presence)) {
        const byRole = new Map<string, number>();
        for (const row of rows) if (row.role && row.start <= start && row.end >= end) {
          byRole.set(row.role, Math.max(byRole.get(row.role) ?? 0, row.minimum));
        }
        for (const [role, estimate] of byRole) {
          const required = Math.min(estimate, people.filter(person => person.role === role).length);
          if (!required) continue;
          const scope = key(sector, role);
          const points = events.get(scope) ?? new Map<number, number>();
          points.set(start, (points.get(start) ?? 0) + required);
          points.set(end, (points.get(end) ?? 0) - required);
          events.set(scope, points);
        }
      }
    }
  }
  return events;
}

function peakBand(points: ReadonlyMap<number, number>): Band | undefined {
  const sorted = [...points].sort(([a], [b]) => a - b);
  let current = 0, best: Band | undefined;
  for (let index = 0; index < sorted.length - 1; index++) {
    const [start, delta] = sorted[index], end = sorted[index + 1][0];
    current += delta;
    if (!best || current > best.protectedDays) best = { start, end, protectedDays: current };
    else if (current === best.protectedDays && best.end === start) best.end = end;
  }
  return best;
}

/** Documentary proof, never a constraint. Call with the server-admitted origin only. */
export function decemberCapacityConflicts(context: EscalaInput, origin?: EscalaInput): EscalaGenerationConflict[] {
  if (!origin || !isDecember2026Cutover(context) || !isDecember2026Cutover(origin)
    || context.generationMode === "HOURS_ONLY" || storeClosingMinutes(context) > 1440
    || context.shifts.some(shift => shift.segments.some(span => span.kind === "WORK" && (span.start < 0 || span.end > 1440)))) return [];

  const capacity = capacityByRole(context);
  return [...protectedByRole(origin)].flatMap(([scope, points]) => {
    const band = peakBand(points), cap = capacity.get(scope) ?? 0;
    if (!band || band.protectedDays <= cap) return [];
    const [sector, role] = JSON.parse(scope) as [string, string];
    return [{ ...band, sector, role, cap, gap: band.protectedDays - cap }];
  }).sort((a, b) => b.gap - a.gap || a.sector.localeCompare(b.sector, "pt-BR")
    || a.role.localeCompare(b.role, "pt-BR") || a.start - b.start).slice(0, 3).map(band => ({
    code: "DECEMBER_FROZEN_COVERAGE_CAPACITY", target: "coverage", date: FIRST, sector: band.sector, role: band.role,
    message: `${band.sector} — ${band.role}, de 01 a 05/12, ${clock(band.start)}–${clock(band.end)}: a referência estimada preserva ${band.protectedDays} presenças somadas nesses dias; a equipe pode oferecer no máximo ${band.cap}. A diferença é de pelo menos ${band.gap} pessoas-dia nesta faixa, não ${band.gap} pessoas a contratar. Não some este número ao de outras faixas.`,
  }));
}
