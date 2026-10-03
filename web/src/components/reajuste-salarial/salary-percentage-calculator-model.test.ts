import { describe, expect, it } from "vitest";
import { salaryIncreasePercentage } from "./salary-percentage-calculator-model";

describe("informational salary percentage calculator", () => {
  it.each([
    ["1.000,00", "1.100,00", "10,00000%"],
    ["1.822,86", "1.864,16", "2,26567%"],
    ["3,00", "4,00", "33,33333%"],
    ["1.000,00", "900,00", "-10,00000%"],
    ["1000", "1000", "0,00000%"],
    ["0,03", "0,02", "-33,33333%"],
  ])("calculates %s to %s without floating point loss", (oldSalary, newSalary, result) => expect(salaryIncreasePercentage(oldSalary, newSalary)).toBe(result));
  it.each([["", "10"], ["0", "10"], ["invalid", "10"], ["10", "-1"], ["10", "1,001"]])("rejects invalid amounts %s %s", (oldSalary, newSalary) => expect(salaryIncreasePercentage(oldSalary, newSalary)).toBeNull());
});
