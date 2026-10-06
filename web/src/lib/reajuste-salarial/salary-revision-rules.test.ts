import { describe, expect, it } from "vitest";
import {
  applySalaryRevisionRules,
  buildSalaryRevisionAnalysis,
} from "./salary-revision-rules";
import type {
  ParsedSalaryRevisionFile,
  SalaryRevisionRule,
} from "./salary-revision-types";

function parsedFile(): ParsedSalaryRevisionFile {
  const base = {
    sourceFile: "FPRE131.xlsx",
    sourceSheet: "Plan1",
    sourceRow: 1,
  };
  return {
    sourceFile: "FPRE131.xlsx",
    sourceSheet: "Plan1",
    employees: [
      { ...base, branchAlias: "Hiper", registration: "3", employeeName: "ZILDA", role: "CAIXA", currentSalaryCents: 203_194n },
      { ...base, branchAlias: "Matriz", registration: "2", employeeName: "BRUNO", role: "CAIXA", currentSalaryCents: 174_570n },
      { ...base, branchAlias: "Matriz", registration: "1", employeeName: "ANA", role: "CAIXA", currentSalaryCents: 138_862n },
    ],
  };
}

function specialRule(overrides: Partial<SalaryRevisionRule> = {}): SalaryRevisionRule {
  return {
    id: "category-a",
    name: "Categoria A",
    minimumSalaryCents: 130_000n,
    maximumSalaryCents: 180_000n,
    newSalaryCents: 190_000n,
    selectedRegistrations: ["000000001"],
    ...overrides,
  } as SalaryRevisionRule;
}

describe("salary revision rules", () => {
  it("applies general and own percentages to selected rules with exact cents", () => {
    const report = applySalaryRevisionRules(parsedFile(), 108n, [
      { id: "general", name: "Geral", minimumSalaryCents: 138862n, maximumSalaryCents: 138862n, selectedRegistrations: ["1"], calculation: "general_percentage", roleFilter: "  cAÍxa " },
      { id: "own", name: "Próprio", minimumSalaryCents: 174570n, maximumSalaryCents: 174570n, selectedRegistrations: ["2"], calculation: "percentage", percentageBasisPoints: 227n },
    ], new Date(), "rules_only");
    const employees = report.groups.flatMap((group) => group.employees);
    expect(employees.map((employee) => [employee.registration, employee.adjustmentCents, employee.newSalaryCents])).toEqual([["1", 1500n, 140362n], ["2", 3963n, 178533n]]);
    expect(employees[0].application).toMatchObject({ percentageBasisPoints: 108n });
    expect(employees[1].application).toMatchObject({ percentageBasisPoints: 227n });
    expect(report.generalPercentageBasisPoints).toBe(108n);
    expect(report.totalAdjustmentCents).toBe(5463n);
    expect(report.generalEmployeeCount).toBe(0);
  });

  it("combines fixed and percentage rules with the remaining general employees", () => {
    const report = applySalaryRevisionRules(parsedFile(), 108n, [
      specialRule(),
      { id: "own", name: "Próprio", minimumSalaryCents: 174570n, maximumSalaryCents: 174570n, selectedRegistrations: ["2"], calculation: "percentage", percentageBasisPoints: 227n },
    ]);
    expect(report.employeeCount).toBe(3);
    expect(report.specialEmployeeCount).toBe(2);
    expect(report.generalEmployeeCount).toBe(1);
    expect(report.totalAdjustmentCents).toBe(57295n);
  });

  it("rejects wrong exact roles and percentage bounds even without request parsing", () => {
    expect(() => applySalaryRevisionRules(parsedFile(), 108n, [specialRule({ roleFilter: "CAIXA CHEFE" })])).toThrow("cargo diferente");
    for (const value of [0n, 10001n]) {
      expect(() => applySalaryRevisionRules(parsedFile(), value, [])).toThrow("percentual geral");
      expect(() => applySalaryRevisionRules(parsedFile(), 0n, [{ id: "own", name: "Próprio", minimumSalaryCents: 0n, maximumSalaryCents: 300000n, selectedRegistrations: ["1"], calculation: "percentage", percentageBasisPoints: value }], new Date(), "rules_only")).toThrow("percentual entre");
    }
    for (const value of [1n, 10000n]) {
      expect(applySalaryRevisionRules(parsedFile(), value, []).employeeCount).toBe(3);
    }
  });
  it("uses fixed salary only for selected employees and percentage for all others", () => {
    const report = applySalaryRevisionRules(
      parsedFile(),
      442n,
      [specialRule()],
      new Date("2026-08-24T12:00:00.000Z"),
    );
    expect(report.groups.map((group) => group.branchAlias)).toEqual(["Matriz", "Hiper"]);
    const employees = report.groups.flatMap((group) => group.employees);
    const special = employees.find((employee) => employee.registration === "1");
    const general = employees.find((employee) => employee.registration === "2");
    expect(special?.application.kind).toBe("special");
    expect(special?.newSalaryCents).toBe(190_000n);
    expect(special?.adjustmentCents).toBe(51_138n);
    expect(general?.application.kind).toBe("general");
    expect(general?.adjustmentCents).toBe(7_716n);
    expect(general?.newSalaryCents).toBe(182_286n);
    expect(report.generalEmployeeCount).toBe(2);
    expect(report.specialEmployeeCount).toBe(1);
    expect(report.newPayrollCents).toBe(
      report.currentPayrollCents + report.totalAdjustmentCents,
    );
  });

  it("rejects overlaps, out-of-range selections and salary reductions", () => {
    expect(() =>
      applySalaryRevisionRules(parsedFile(), 442n, [
        specialRule(),
        specialRule({ id: "second", name: "Segunda" }),
      ]),
    ).toThrow("mais de uma regra");
    expect(() =>
      applySalaryRevisionRules(parsedFile(), 442n, [
        specialRule({ selectedRegistrations: ["3"] }),
      ]),
    ).toThrow("fora da faixa");
    expect(() =>
      applySalaryRevisionRules(parsedFile(), 442n, [
        specialRule({ newSalaryCents: 130_000n }),
      ]),
    ).toThrow("menor que o salário atual");
  });

  it("supports multiple rules while excluding every unselected employee", () => {
    const report = applySalaryRevisionRules(
      parsedFile(),
      0n,
      [
        specialRule(),
        specialRule({
          id: "category-b",
          name: "Categoria B",
          minimumSalaryCents: 203_194n,
          maximumSalaryCents: 203_194n,
          newSalaryCents: 212_000n,
          selectedRegistrations: ["3"],
        }),
      ],
      new Date("2026-08-24T12:00:00.000Z"),
      "rules_only",
    );
    expect(report.adjustmentScope).toBe("rules_only");
    expect(report.generalPercentageBasisPoints).toBeNull();
    expect(report.generalEmployeeCount).toBe(0);
    expect(report.specialEmployeeCount).toBe(2);
    expect(
      report.groups.flatMap((group) => group.employees).map((employee) => employee.registration),
    ).toEqual(["1", "3"]);
    expect(report.currentPayrollCents).toBe(342_056n);
    expect(report.totalAdjustmentCents).toBe(59_944n);
    expect(() =>
      applySalaryRevisionRules(parsedFile(), 0n, [], new Date(), "rules_only"),
    ).toThrow("ao menos uma regra");
  });

  it("rejects duplicate rule identifiers", () => {
    expect(() =>
      applySalaryRevisionRules(parsedFile(), 442n, [
        specialRule(),
        specialRule({
          name: "Categoria B",
          selectedRegistrations: ["2"],
        }),
      ]),
    ).toThrow("identificador");
  });

  it("builds an ordered analysis with exact cent strings", () => {
    const analysis = buildSalaryRevisionAnalysis(parsedFile(), "a".repeat(64));
    expect(analysis.employees.map((employee) => employee.employeeName)).toEqual([
      "ANA",
      "BRUNO",
      "ZILDA",
    ]);
    expect(analysis.minimumSalaryCents).toBe("138862");
    expect(analysis.maximumSalaryCents).toBe("203194");
    expect(analysis.distinctSalaryCount).toBe(3);
  });

  it("rejects oversized analyses before sending thousands of employees to the browser", () => {
    const file = parsedFile();
    file.employees = Array.from({ length: 5_001 }, (_, index) => ({
      ...file.employees[0],
      registration: String(index + 1),
      employeeName: `COLABORADOR ${index + 1}`,
    }));
    expect(() => buildSalaryRevisionAnalysis(file, "a".repeat(64))).toThrow(
      "5.000 colaboradores",
    );
  });
});
