import { describe, expect, it } from "vitest";
import type { SectorCoverageGap } from "./coverage-presence";
import { summarizeCoverageGaps } from "./coverage-summary";

function gap(overrides: Partial<SectorCoverageGap> = {}): SectorCoverageGap {
  return { sector: "Padaria", date: "2026-11-02", start: 480, end: 540, present: 1, minimum: 2,
    estimated: true, kind: "estimate", roles: [], suggestion: "Rever horários", ...overrides };
}

describe("compact sector coverage summary", () => {
  it("returns one A-Z sector row regardless of roles, clocks, dates or duplicate records", () => {
    const rows = Array.from({ length: 30 }, (_, index) => gap({ date: `2026-11-${String(index + 1).padStart(2, "0")}` }));
    const before = structuredClone(rows);
    const summaries = summarizeCoverageGaps([...rows, ...rows, gap({ sector: "Açougue" }), gap({ sector: "Hortifrúti" })]);
    expect(summaries.map(row => row.sector)).toEqual(["Açougue", "Hortifrúti", "Padaria"]);
    expect(summaries[2].dates).toHaveLength(30);
    expect(summaries[2].peakMissing).toBe(1);
    expect(summaries[2].windows).toHaveLength(1);
    expect(rows).toEqual(before);
  });
  it("does not sum dates or count informed and estimated references to a role twice", () => {
    const roles = [{ role: "Padeiro", present: 1, minimum: 3, estimated: true }, { role: "Padeiro", present: 1, minimum: 2, estimated: false }];
    const [summary] = summarizeCoverageGaps([gap({ roles }), gap({ date: "2026-11-03", roles }), gap({ roles })]);
    expect(summary.peakMissing).toBe(2);
    expect(summary.peakSectorMissing).toBe(1);
    expect(summary.minimumDates).toEqual(["2026-11-02", "2026-11-03"]);
    expect(summary.hasEstimates).toBe(true);
  });
  it("separates composition from total staffing and keeps hard requirements visible", () => {
    const [summary] = summarizeCoverageGaps([gap({ present: 4, minimum: 4,
      roles: [{ role: "Padeiro", present: 0, minimum: 1, estimated: false }] })]);
    expect(summary).toMatchObject({ peakMissing: 1, peakSectorMissing: 0, hasRoleMismatch: true, minimumDates: ["2026-11-02"] });
  });
  it("never fills a covered interval between two real shortages", () => {
    const [summary] = summarizeCoverageGaps([gap(), gap({ start: 720, end: 780 })]);
    expect(summary.windows.map(row => [row.start, row.end])).toEqual([[480, 540], [720, 780]]);
  });
  it("does not imply different day-specific windows were present on every affected day", () => {
    const [summary] = summarizeCoverageGaps([gap(), gap({ date: "2026-11-03", start: 540, end: 600 })]);
    expect(summary.windows.map(row => [row.start, row.end, row.dates])).toEqual([
      [480, 540, ["2026-11-02"]], [540, 600, ["2026-11-03"]],
    ]);
  });
  it("selects at most three priority windows and retains all affected dates and zero-presence warnings", () => {
    const rows = Array.from({ length: 6 }, (_, index) => gap({ start: 360 + index * 90, end: 390 + index * 90, present: index === 5 ? 0 : 1 }));
    rows.push(gap({ date: "2026-11-04", estimated: false, start: 1100, end: 1130 }));
    const [summary] = summarizeCoverageGaps(rows);
    expect(summary.windows).toHaveLength(3);
    expect(summary.windows.some(row => row.start === 1100)).toBe(true);
    expect(summary.windows.some(row => row.start === 810)).toBe(true);
    expect(summary.noServiceDates).toEqual(["2026-11-02"]);
    expect(summary.minimumDates).toEqual(["2026-11-04"]);
    expect(summary.dates).toEqual(["2026-11-02", "2026-11-04"]);
  });
  it("ignores invalid intervals and returns an empty summary for empty inputs", () => {
    expect(summarizeCoverageGaps([])).toEqual([]);
    expect(summarizeCoverageGaps([gap({ end: 480 })])).toEqual([]);
  });
});
