import { describe, expect, it } from "vitest";
import {
  parseCompetencyFileName,
  sortAndValidateCompetencies,
} from "./competency";

describe("salary adjustment competencies", () => {
  it("parses and orders MM-AAAA.xlsx names", () => {
    const june = parseCompetencyFileName("06-2026.xlsx");
    const july = parseCompetencyFileName("07-2026.xlsx");
    expect(june).toMatchObject({ key: "06-2026", order: 202606 });
    expect(sortAndValidateCompetencies([july, june])).toEqual([june, july]);
  });

  it("rejects invalid and duplicate competencies", () => {
    expect(() => parseCompetencyFileName("6-2026.xlsx")).toThrow();
    expect(() => parseCompetencyFileName("06-2026.xls")).toThrow();
    const competency = parseCompetencyFileName("06-2026.xlsx");
    expect(() => sortAndValidateCompetencies([competency, competency])).toThrow();
  });
});
