import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { allocateReportColumns, employeeRowHeight } from "./pdf-layout";

describe("salary adjustment PDF layout", () => {
  it("fills A4 landscape usable width without lateral overflow", () => {
    const competencies = ["06", "07", "08", "09"].map((month) =>
      parseCompetencyFileName(`${month}-2026.xlsx`),
    );
    const left = 24;
    const usable = 841.89 - 48;
    const columns = allocateReportColumns(usable, competencies, left);
    const right = columns.at(-1);
    expect(columns[0].x).toBe(left);
    expect((right?.x ?? 0) + (right?.width ?? 0)).toBeCloseTo(841.89 - 24, 6);
    expect(columns.reduce((sum, column) => sum + column.width, 0)).toBeCloseTo(usable, 6);
    expect(Math.min(...columns.map((column) => column.width))).toBeGreaterThanOrEqual(50);
  });

  it("keeps employee rows whole and bounded", () => {
    expect(employeeRowHeight(2)).toBe(18);
    expect(employeeRowHeight(20)).toBe(26);
    expect(employeeRowHeight(100)).toBe(32);
  });
});
