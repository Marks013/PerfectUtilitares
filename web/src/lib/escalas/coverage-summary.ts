import type { SectorCoverageGap } from "./coverage-presence";
import { compareSectors } from "./order";

type CoveragePriorityWindow = {
  start: number; end: number; dates: string[]; peakMissing: number;
  peakSectorMissing: number; hasRoleMismatch: boolean;
};
export type SectorCoverageSummary = {
  sector: string; dates: string[]; noServiceDates: string[]; minimumDates: string[];
  hasEstimates: boolean; peakMissing: number; peakSectorMissing: number;
  hasRoleMismatch: boolean; windows: CoveragePriorityWindow[];
};

/** A role shortfall can require redistribution, not an additional person in the sector. */
function shortfall(gaps: SectorCoverageGap[]) {
  const roles = new Map<string, number>();
  let sector = 0;
  for (const gap of gaps) {
    sector = Math.max(sector, gap.minimum - gap.present, 0);
    for (const role of gap.roles) {
      // An informed and an estimated reference for the same role are not additive.
      roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
    }
  }
  const roleMissing = [...roles.values()].reduce((sum, count) => sum + count, 0);
  return { missing: Math.max(sector, roleMissing), sector, roleMismatch: roleMissing > 0 };
}

type RankedWindow = CoveragePriorityWindow & { score: number; hard: boolean; empty: boolean; signature: string };

/** One sector summary; details remain in the source, never rendered as thousands of cards. */
export function summarizeCoverageGaps(gaps: readonly SectorCoverageGap[]): SectorCoverageSummary[] {
  const sectors = new Map<string, SectorCoverageGap[]>();
  for (const gap of gaps) {
    if (gap.end <= gap.start) continue;
    const group = sectors.get(gap.sector);
    if (group) group.push(gap);
    else sectors.set(gap.sector, [gap]);
  }
  return [...sectors].sort(([a], [b]) => compareSectors(a, b)).map(([sector, rows]) => {
    const dates = [...new Set(rows.map(row => row.date))].sort();
    const noServiceDates = [...new Set(rows.filter(row => row.present === 0).map(row => row.date))].sort();
    const minimumDates = [...new Set(rows.filter(row => !row.estimated || row.roles.some(role => !role.estimated)).map(row => row.date))].sort();
    const points = [...new Set(rows.flatMap(row => [row.start, row.end]))].sort((a, b) => a - b);
    const windows: RankedWindow[] = [];
    let previous: RankedWindow | undefined;
    let peakMissing = 0, peakSectorMissing = 0, hasRoleMismatch = false;
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index], end = points[index + 1];
      const active = rows.filter(row => row.start <= start && row.end >= end);
      if (!active.length) { previous = undefined; continue; }
      const byDate = new Map<string, SectorCoverageGap[]>();
      for (const row of active) {
        const day = byDate.get(row.date);
        if (day) day.push(row);
        else byDate.set(row.date, [row]);
      }
      const windowDates = [...byDate.keys()].sort();
      const hardDates = windowDates.filter(date => byDate.get(date)?.some(row => !row.estimated || row.roles.some(role => !role.estimated)));
      const emptyDates = windowDates.filter(date => byDate.get(date)?.some(row => row.present === 0));
      let missing = 0, sectorMissing = 0, roleMismatch = false, score = 0;
      for (const day of byDate.values()) {
        const result = shortfall(day);
        missing = Math.max(missing, result.missing);
        sectorMissing = Math.max(sectorMissing, result.sector);
        roleMismatch ||= result.roleMismatch;
        score += result.missing * (end - start);
      }
      peakMissing = Math.max(peakMissing, missing);
      peakSectorMissing = Math.max(peakSectorMissing, sectorMissing);
      hasRoleMismatch ||= roleMismatch;
      // Merge only when the same dates are affected throughout. A covered interval
      // or a changed date set must not become one misleading all-day envelope.
      const signature = JSON.stringify([windowDates, hardDates, emptyDates]);
      if (previous && previous.end === start && previous.signature === signature) {
        previous.end = end;
        previous.peakMissing = Math.max(previous.peakMissing, missing);
        previous.peakSectorMissing = Math.max(previous.peakSectorMissing, sectorMissing);
        previous.hasRoleMismatch ||= roleMismatch;
        previous.score += score;
      } else {
        previous = { start, end, dates: windowDates, peakMissing: missing, peakSectorMissing: sectorMissing,
          hasRoleMismatch: roleMismatch, score, hard: hardDates.length > 0, empty: emptyDates.length > 0, signature };
        windows.push(previous);
      }
    }
    const priority = [...windows].sort((a, b) => Number(b.hard) - Number(a.hard)
      || Number(b.empty) - Number(a.empty) || b.score - a.score || b.peakMissing - a.peakMissing || a.start - b.start)
      .slice(0, 3).sort((a, b) => a.start - b.start || a.end - b.end)
      .map(({ start, end, dates: affected, peakMissing: missing, peakSectorMissing: sectorMissing, hasRoleMismatch: mismatch }) => ({
        start, end, dates: affected, peakMissing: missing, peakSectorMissing: sectorMissing, hasRoleMismatch: mismatch,
      }));
    return { sector, dates, noServiceDates, minimumDates, hasEstimates: rows.some(row => row.estimated || row.roles.some(role => role.estimated)),
      peakMissing, peakSectorMissing, hasRoleMismatch, windows: priority };
  });
}
