import { describe, expect, it } from "vitest";
import {
  formatUnimedBranchForPdf,
  formatUnimedCompetency,
  nextUnimedCompetency,
} from "@/lib/unimed/print-format";

describe("Unimed print format", () => {
  it.each([
    ["MATRIZ", "M"],
    ["ICARAIMA", "ICA"],
    ["ICARAÍMA", "ICA"],
    ["BIG", "S"],
    ["HIPER", "P"],
    ["TIRADENTES", "T"],
    ["ATACADO", "A"],
    ["CASTELO", "C"],
    ["MULTI ATACADO", "MA"],
    ["ANCHIETA", "AN"],
    ["M - MATRIZ", "M"],
    ["MA - MULTI ATACADO", "MA"],
  ])("maps %s to %s", (input, expected) => {
    expect(formatUnimedBranchForPdf(input)).toBe(expected);
  });

  it("formats and advances a competency", () => {
    expect(formatUnimedCompetency("2026-08")).toBe("08/2026");
    expect(nextUnimedCompetency("2026-12")).toBe("01/2027");
  });
});
