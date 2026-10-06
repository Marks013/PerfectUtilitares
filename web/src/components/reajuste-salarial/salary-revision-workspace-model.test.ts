import { describe, expect, it } from "vitest";
import type { SalaryRevisionAnalysis } from "@/lib/reajuste-salarial/salary-revision-types";
import {
  candidatesForRule,
  normalizeMoneyInput,
  serializeSalaryRevisionRules,
  validateSalaryRevisionGeneration,
  updateSalaryRevisionRule,
  selectSalaryRevisionCandidates,
} from "./salary-revision-workspace-model";

const analysis: SalaryRevisionAnalysis = {
  fileHash: "a".repeat(64),
  sourceFile: "FPRE131.xlsx",
  employeeCount: 2,
  branchCount: 1,
  distinctSalaryCount: 2,
  minimumSalaryCents: "138862",
  maximumSalaryCents: "203194",
  salaries: [],
  employees: [
    { branchAlias: "Matriz", registration: "1", employeeName: "ANA", role: "CAIXA", currentSalaryCents: "138862" },
    { branchAlias: "Matriz", registration: "2", employeeName: "BIA", role: "CAIXA", currentSalaryCents: "203194" },
  ],
};

const rule = {
  id: "rule-1",
  name: "Categoria",
  minimumSalary: "1.300,00",
  maximumSalary: "2.100,00",
  newSalary: "2.250,00",
  selectedRegistrations: ["1"],
};

describe("salary revision workspace model", () => {
  it("keeps eligible selections when money formatting changes and removes only outside filters", () => {
    expect(updateSalaryRevisionRule(analysis, rule, { minimumSalary: "1300,00" }).selectedRegistrations).toEqual(["1"]);
    expect(updateSalaryRevisionRule(analysis, { ...rule, selectedRegistrations: ["1", "2"] }, { minimumSalary: "2.000,00" }).selectedRegistrations).toEqual(["2"]);
    expect(updateSalaryRevisionRule(analysis, rule, { roleFilter: "REPOSITOR" }).selectedRegistrations).toEqual([]);
  });

  it("uses the search when selecting results and prevents overlaps", () => {
    const empty = { ...rule, selectedRegistrations: [] };
    expect(selectSalaryRevisionCandidates(analysis, [empty], empty, "BIA")).toEqual(["2"]);
    expect(selectSalaryRevisionCandidates(analysis, [rule], rule, "BIA")).toEqual(["1", "2"]);
    const other = { ...rule, id: "other", selectedRegistrations: ["2"] };
    expect(selectSalaryRevisionCandidates(analysis, [empty, other], empty)).toEqual(["1"]);
    expect(candidatesForRule(analysis, { ...rule, roleFilter: "caixa" })).toHaveLength(2);
    expect(candidatesForRule(analysis, { ...rule, roleFilter: "CAIXA AUXILIAR" })).toHaveLength(0);
  });

  it("supports general or individual percentages in rules-only without requiring fixed salary", () => {
    const file = new File(["xlsx"], "FPRE131.xlsx");
    const general = { ...rule, calculation: "general_percentage" as const, newSalary: "" };
    expect(validateSalaryRevisionGeneration(file, analysis, "1,03", [general], "rules_only")).toEqual([]);
    expect(validateSalaryRevisionGeneration(file, analysis, "", [general], "rules_only")).toContain("Informe um percentual geral entre 0,01 e 100,00.");
    const own = { ...general, calculation: "percentage" as const, percentage: "2,26" };
    expect(validateSalaryRevisionGeneration(file, analysis, "", [own], "rules_only")).toEqual([]);
    expect(JSON.parse(serializeSalaryRevisionRules([own]))[0]).toMatchObject({ calculation: "percentage", percentageBasisPoints: "226" });
    expect(JSON.parse(serializeSalaryRevisionRules([general]))[0]).not.toHaveProperty("newSalaryCents");
    expect(validateSalaryRevisionGeneration(file, analysis, "", [{ ...own, percentage: "0" }], "rules_only")).toContain("Informe um percentual próprio entre 0,01 e 100,00 na regra Categoria.");
  });
  it("filters an inclusive Brazilian salary range", () => {
    expect(candidatesForRule(analysis, rule).map((employee) => employee.registration)).toEqual([
      "1",
      "2",
    ]);
  });

  it("serializes exact cents without floating point", () => {
    expect(JSON.parse(serializeSalaryRevisionRules([rule]))).toMatchObject([{
      minimumSalaryCents: "130000",
      maximumSalaryCents: "210000",
      newSalaryCents: "225000",
      selectedRegistrations: ["1"],
    }]);
  });

  it("normalizes monetary fields with Brazilian punctuation", () => {
    expect(normalizeMoneyInput("1300")).toBe("1.300,00");
    expect(normalizeMoneyInput("2031,94")).toBe("2.031,94");
    expect(normalizeMoneyInput("2.100,0")).toBe("2.100,00");
    expect(normalizeMoneyInput("")).toBe("");
  });

  it("accepts a valid generation and blocks overlaps or salary reductions", () => {
    const file = new File(["xlsx"], "FPRE131.xlsx");
    expect(validateSalaryRevisionGeneration(file, analysis, "4,42", [rule])).toEqual([]);
    const overlap = { ...rule, id: "rule-2", name: "Outra" };
    expect(validateSalaryRevisionGeneration(file, analysis, "4,42", [rule, overlap])).toContain(
      "O cadastro 1 está em mais de uma regra.",
    );
    expect(
      validateSalaryRevisionGeneration(file, analysis, "4,42", [
        { ...rule, newSalary: "1.300,00" },
      ]),
    ).toContain("O novo salário da regra Categoria é menor que o atual do cadastro 1.");
  });

  it("allows only selected rules without a general percentage", () => {
    const file = new File(["xlsx"], "FPRE131.xlsx");
    expect(
      validateSalaryRevisionGeneration(
        file,
        analysis,
        "",
        [rule],
        "rules_only",
      ),
    ).toEqual([]);
    expect(
      validateSalaryRevisionGeneration(file, analysis, "", [], "rules_only"),
    ).toContain(
      "Adicione ao menos uma regra para reajustar somente os selecionados.",
    );
  });
});
