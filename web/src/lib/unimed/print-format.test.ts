import { describe, expect, it } from "vitest";
import {
  formatUnimedBranchForPdf,
  formatUnimedCompetency,
  nextUnimedCompetency,
} from "@/lib/unimed/print-format";

describe("Unimed print format", () => {
  it.each([
    ["M", "M"], ["MATRIZ", "M"], ["M - MATRIZ", "M"],
    ["I", "I"], ["ICARAIMA", "I"], ["ICARAÍMA", "I"], ["I - ICARAÍMA", "I"],
    ["S", "S"], ["BIG", "S"], ["S - BIG", "S"],
    ["P", "P"], ["HIPER", "P"], ["P - HIPER", "P"],
    ["T", "T"], ["TIRADENTES", "T"], ["T - TIRADENTES", "T"],
    ["A", "A"], ["ATACADO", "A"], ["A - ATACADO", "A"],
    ["C", "C"], ["CASTELO", "C"], ["CASTELO BRANCO", "C"],
    ["C - CASTELO BRANCO", "C"], ["001 - CASTELO BRANCO", "C"],
    ["MA", "MA"], ["MULTI ATACADO", "MA"], ["MA - MULTI ATACADO", "MA"],
    ["AN", "AN"], ["ANCHIETA", "AN"], ["AN - ANCHIETA", "AN"],
  ])("maps %s to %s", (input, expected) => {
    expect(formatUnimedBranchForPdf(input)).toBe(expected);
  });

  it("preserves an unknown branch", () => {
    expect(formatUnimedBranchForPdf("Filial desconhecida")).toBe(
      "Filial desconhecida",
    );
  });

  it("formats and advances a competency", () => {
    expect(formatUnimedCompetency("2026-08")).toBe("08/2026");
    expect(nextUnimedCompetency("2026-12")).toBe("01/2027");
  });
});
