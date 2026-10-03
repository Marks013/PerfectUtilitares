import { describe, expect, it } from "vitest";
import {
  calculateAdjustmentCents,
  formatCents,
  parseMoneyCents,
  parsePercentageBasisPoints,
  parsePercentageHundredThousandths,
  formatPercentageHundredThousandths,
  calculateAdjustmentAtHundredThousandths,
} from "./money";

describe("salary adjustment money", () => {
  it("uses exact five-decimal percentage units and half-up cents", () => {
    expect(parsePercentageHundredThousandths("1,23456")).toBe(123456n);
    expect(parsePercentageHundredThousandths("0.00001")).toBe(1n);
    expect(parsePercentageHundredThousandths("100,00000")).toBe(10_000_000n);
    expect(formatPercentageHundredThousandths(226555n)).toBe("2,26555%");
    expect(calculateAdjustmentAtHundredThousandths(200_000n, 123456n)).toBe(2469n);
    expect(calculateAdjustmentAtHundredThousandths(1n, 5_000_000n)).toBe(1n);
    expect(calculateAdjustmentAtHundredThousandths(1n, 4_999_999n)).toBe(0n);
    expect(calculateAdjustmentAtHundredThousandths(5_000_000n, 1n)).toBe(1n);
    expect(calculateAdjustmentAtHundredThousandths(4_999_999n, 1n)).toBe(0n);
    for (const invalid of ["0", "0,00000", "1,234567", "100,00001", "", "1%", "NaN"]) expect(() => parsePercentageHundredThousandths(invalid)).toThrow();
  });
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

  it("applies half-up rounding at the cent boundary", () => {
    expect(calculateAdjustmentCents(1n, 5_000n)).toBe(1n);
    expect(calculateAdjustmentCents(1n, 4_999n)).toBe(0n);
    expect(calculateAdjustmentCents(999_999_999n, 1n)).toBe(100_000n);
  });

  it("preserves exact cent conversions for supported decimal inputs", () => {
    expect(parseMoneyCents("0,01")).toBe(1n);
    expect(parseMoneyCents("4.560,8")).toBe(456_080n);
    expect(parseMoneyCents(4560.84)).toBe(456_084n);
    expect(parsePercentageBasisPoints("0,01")).toBe(1n);
    expect(parsePercentageBasisPoints("100,00")).toBe(10_000n);
  });

  it("rejects invalid or over-precise values", () => {
    expect(() => parseMoneyCents("1.234,567")).toThrow();
    expect(() => parseMoneyCents("4,560.84")).toThrow();
    expect(() => parseMoneyCents(4.567)).toThrow();
    expect(() => parseMoneyCents(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => parseMoneyCents(-1)).toThrow();
    expect(() => parsePercentageBasisPoints("0")).toThrow();
    expect(() => parsePercentageBasisPoints("4,421")).toThrow();
    expect(() => parsePercentageBasisPoints("4,42%")).toThrow();
    expect(() => parsePercentageBasisPoints("100,01")).toThrow();
  });
});
