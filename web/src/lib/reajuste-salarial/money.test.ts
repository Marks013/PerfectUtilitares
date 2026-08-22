import { describe, expect, it } from "vitest";
import {
  calculateAdjustmentCents,
  formatCents,
  parseMoneyCents,
  parsePercentageBasisPoints,
} from "./money";

describe("salary adjustment money", () => {
  it("parses Brazilian money and percentages without floating point math", () => {
    expect(parseMoneyCents("4.560,84")).toBe(456_084n);
    expect(parseMoneyCents(3451.68)).toBe(345_168n);
    expect(parsePercentageBasisPoints("4,42")).toBe(442n);
    expect(parsePercentageBasisPoints("4.42")).toBe(442n);
  });

  it("rounds each competency to cents", () => {
    expect(calculateAdjustmentCents(456_084n, 442n)).toBe(20_159n);
    expect(calculateAdjustmentCents(345_168n, 442n)).toBe(15_256n);
    expect(formatCents(35_415n)).toBe("R$ 354,15");
  });

  it("rejects invalid or over-precise values", () => {
    expect(() => parseMoneyCents("1.234,567")).toThrow();
    expect(() => parseMoneyCents(-1)).toThrow();
    expect(() => parsePercentageBasisPoints("0")).toThrow();
    expect(() => parsePercentageBasisPoints("100,01")).toThrow();
  });
});
