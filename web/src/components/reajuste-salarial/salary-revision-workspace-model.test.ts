import { describe, expect, it } from "vitest";
import type { SalaryRevisionAnalysis } from "@/lib/reajuste-salarial/salary-revision-types";
import {
  candidatesForRule,
  serializeSalaryRevisionRules,
  validateSalaryRevisionGeneration,
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
});
