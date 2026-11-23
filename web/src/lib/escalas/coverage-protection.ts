import { buildCoveragePresence } from "./coverage-presence";
import { dayOfWeek, visibleDates } from "./dates";
import { operationalEscalaInput } from "./eligibility";
import type { EscalaInput } from "./types";

const MAX_PROTECTED_WINDOWS = 12_000;

export type CoverageServiceScope = "HORIZON" | "MONTH" | "SUNDAYS" | "MONTH_SUNDAYS";
type ProtectedDay = { date: string; sector: string };
type ProtectedBand = { sector: string; role: string; start: number; end: number; scope: CoverageServiceScope; minimum: number };
export type CoverageServiceProtection = { days: ProtectedDay[]; bands: ProtectedBand[] };

export function coverageServiceScopes(date: string, visible: ReadonlySet<string>): CoverageServiceScope[] {
  const scopes: CoverageServiceScope[] = ["HORIZON"];
  const inMonth = visible.has(date);
  if (inMonth) scopes.push("MONTH");
  if (dayOfWeek(date) === 6) {
    scopes.push("SUNDAYS");
    if (inMonth) scopes.push("MONTH_SUNDAYS");
  }
  return scopes;
}

type Span = { start: number; end: number };
function mergedSpans(spans: Span[]) {
  const output: Span[] = [];
  for (const { start, end } of spans.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = output.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else output.push({ start, end });
  }
  return output;
}

/** Reproduce the verifier's actual WORK presence, including windows with no demand. */
export function frozenCoverageService(reference: EscalaInput, excludedDates: readonly string[] = []): CoverageServiceProtection | null {
  const input = operationalEscalaInput(reference);
  const visible = new Set(visibleDates(input));
  const days: ProtectedDay[] = [], bands: ProtectedBand[] = [];
  const groups = new Map<string, { sector: string; role: string; scope: CoverageServiceScope; events: Map<number, number> }>();
  for (const [key, intervals] of buildCoveragePresence(input)) {
    if (!intervals.length) continue;
    const split = key.indexOf("\0"), date = key.slice(0, split), sector = key.slice(split + 1);
    if (date < input.startDate || date > input.endDate || excludedDates.includes(date)) continue;
    days.push({ date, sector });
    if (days.length > 10_500) return null;
    const people = new Map<string, { role: string; spans: Span[] }>();
    for (const { start, end, employee } of intervals) {
      const person = people.get(employee.id) ?? { role: employee.role, spans: [] };
      person.spans.push({ start, end });
      people.set(employee.id, person);
    }
    const scopes = coverageServiceScopes(date, visible);
    for (const { role, spans } of people.values()) {
      const work = mergedSpans(spans);
      for (const scope of scopes) {
        const key = JSON.stringify([sector, role, scope]);
        const group = groups.get(key) ?? { sector, role, scope, events: new Map<number, number>() };
        for (const { start, end } of work) {
          group.events.set(start, (group.events.get(start) ?? 0) + 1);
          group.events.set(end, (group.events.get(end) ?? 0) - 1);
        }
        groups.set(key, group);
      }
    }
  }
  for (const { sector, role, scope, events } of groups.values()) {
    const minutes = [...events].sort(([a], [b]) => a - b);
    let previous: ProtectedBand | undefined, minimum = 0;
    for (let i = 0; i + 1 < minutes.length; i++) {
      const [start, delta] = minutes[i], end = minutes[i + 1][0];
      minimum += delta;
      if (minimum < 1) continue;
      if (previous?.end === start && previous.minimum === minimum) previous.end = end;
      else {
        previous = { sector, role, scope, start, end, minimum };
        bands.push(previous);
        if (bands.length > MAX_PROTECTED_WINDOWS) return null;
      }
    }
  }
  return { days, bands };
}
