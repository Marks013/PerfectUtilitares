import { describe, expect, it } from "vitest";
import { canonicalBranchCode } from "./branch-code";

describe("canonical scheduling branch identity", () => {
  it.each([["8", "08"], ["08", "08"], ["0008", "08"], [" 8 ", "08"], ["0", "00"], ["000", "00"],
    ["00123", "123"], ["  LOJA-08  ", "LOJA-08"], ["A08", "A08"], ["a08", "a08"], ["８", "８"],
    ["\u00a0\u200a8\ufeff", "08"]])("canonicalizes %s as %s without merging textual branches", (raw, expected) => {
    expect(canonicalBranchCode(raw)).toBe(expected);
    expect(canonicalBranchCode(canonicalBranchCode(raw))).toBe(expected);
  });
  it("does not round or truncate identifiers beyond JavaScript's numeric precision", () => {
    const value = "900719925474099312345678901234567890";
    expect(canonicalBranchCode("000" + value)).toBe(value);
  });
});
