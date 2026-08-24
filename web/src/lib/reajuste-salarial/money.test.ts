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
