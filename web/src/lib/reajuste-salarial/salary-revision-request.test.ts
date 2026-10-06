import { describe, expect, it } from "vitest";
import { parseSalaryRevisionRules } from "./salary-revision-request";
import { salaryRevisionRoleMatches, salaryRevisionUsesGeneralPercentage } from "./salary-revision-matching";

const selection = { id: "r", name: "Regra", minimumSalaryCents: "0", maximumSalaryCents: "300000", selectedRegistrations: ["1"] };

describe("salary revision rule requests", () => {
  it("preserves legacy fixed salaries and parses all explicit calculation modes", () => {
    const rules = parseSalaryRevisionRules(JSON.stringify([
      { ...selection, newSalaryCents: "200000" },
      { ...selection, id: "f", calculation: "fixed", newSalaryCents: "200000" },
      { ...selection, id: "g", calculation: "general_percentage", roleFilter: "Caixa" },
      { ...selection, id: "p", calculation: "percentage", percentageBasisPoints: "227" },
    ]));
    expect(rules[0]).toMatchObject({ newSalaryCents: 200000n });
    expect(rules[1]).toMatchObject({ calculation: "fixed", newSalaryCents: 200000n });
    expect(rules[2]).toMatchObject({ calculation: "general_percentage", roleFilter: "Caixa" });
    expect(rules[3]).toMatchObject({ calculation: "percentage", percentageBasisPoints: 227n });
  });
  it.each([
    { calculation: "fixed" },
    { calculation: "percentage" },
    { calculation: "percentage", percentageBasisPoints: "0" },
    { calculation: "percentage", percentageBasisPoints: "10001" },
    { calculation: "percentage", percentageBasisPoints: 227 },
    { calculation: "percentage", percentageBasisPoints: "227", newSalaryCents: "200000" },
    { calculation: "general_percentage", newSalaryCents: "200000" },
    { calculation: "general_percentage", percentageBasisPoints: "108" },
    { calculation: "other", newSalaryCents: "200000" },
    { newSalaryCents: "200000", percentageBasisPoints: "108" },
  ])("rejects missing or conflicting calculation fields %j", (fields) => {
    expect(() => parseSalaryRevisionRules(JSON.stringify([{ ...selection, ...fields }]))).toThrow();
  });
  it("matches exact normalized roles and detects general value requirements", () => {
    expect(salaryRevisionRoleMatches(" EmBALADOR   a MÃO ", "embalador a mao")).toBe(true);
    expect(salaryRevisionRoleMatches("CAIXA CHEFE", "CAIXA")).toBe(false);
    expect(salaryRevisionRoleMatches("CAIXA", "")).toBe(true);
    expect(salaryRevisionUsesGeneralPercentage("rules_only", [{ calculation: "general_percentage" }])).toBe(true);
    expect(salaryRevisionUsesGeneralPercentage("rules_only", [{ calculation: "percentage" }])).toBe(false);
    expect(salaryRevisionUsesGeneralPercentage("all", [])).toBe(true);
  });
});
