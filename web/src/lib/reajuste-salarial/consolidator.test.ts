import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { consolidatePayrollFiles } from "./consolidator";
import type { ParsedPayrollFile } from "./types";

function payrollFile(
  fileName: string,
  rows: Array<[string, string, string, bigint]>,
): ParsedPayrollFile {
  const competency = parseCompetencyFileName(fileName);
  return {
    competency,
    sourceFile: fileName,
    sourceSheet: "Plan1",
    rows: rows.map(([registration, employeeName, branchAlias, baseCents], index) => ({
      competency,
      sourceFile: fileName,
      sourceSheet: "Plan1",
      sourceRow: index + 1,
      registration,
      employeeName,
      branchAlias,
      baseCents,
    })),
  };
}

describe("salary adjustment consolidation", () => {
  it("unifies registrations, uses latest labels and sums rounded months", () => {
    const report = consolidatePayrollFiles(
      [
        payrollFile("06-2026.xlsx", [
          ["000000001", "COLABORADOR EXEMPLO", "MATRIZ", 456_084n],
          ["000000002", "ZELIA TESTE", "LOJA B", 100_000n],
        ]),
        payrollFile("07-2026.xlsx", [
          ["000000001", "Colaborador Exemplo", "LOJA A", 345_168n],
          ["000000003", "ANA TESTE", "LOJA A", 200_000n],
        ]),
      ],
      442n,
      new Date("2026-08-22T12:00:00.000Z"),
    );

    expect(report.employeeCount).toBe(3);
    expect(report.groups.map((group) => group.branchAlias)).toEqual([
      "LOJA A",
      "LOJA B",
    ]);
    const example = report.groups[0].employees.find(
      (employee) => employee.registration === "000000001",
    );
    expect(example?.employeeName).toBe("Colaborador Exemplo");
    expect(example?.totalAdjustmentCents).toBe(35_415n);
    const julyOnly = report.groups[0].employees.find(
      (employee) => employee.registration === "000000003",
    );
    expect(julyOnly?.basesByCompetency.get("06-2026")).toBeNull();
    expect(julyOnly?.adjustmentsByCompetency.get("06-2026")).toBe(0n);
  });

  it("blocks materially different names for one registration", () => {
    expect(() =>
      consolidatePayrollFiles(
        [
          payrollFile("06-2026.xlsx", [["1", "ANA SILVA", "A", 100n]]),
          payrollFile("07-2026.xlsx", [["1", "MARIA SILVA", "A", 100n]]),
        ],
        100n,
      ),
    ).toThrow(/nomes diferentes/);
  });

  it("uses the required branch order and canonical display names", () => {
    const inputOrder = [
      "ANCHIETA",
      "Loja adicional",
      "MULTI ATACADO",
      "CASTELO BRANCO",
      "ATACADO",
      "TIRADENTES",
      "HIPERMERCADO",
      "BIG",
      "ICARAIMA",
      "MATRIZ",
    ];
    const report = consolidatePayrollFiles(
      [
        payrollFile(
          "06-2026.xlsx",
          inputOrder.map((branchAlias, index) => [
            String(index + 1),
            `COLABORADOR ${index + 1}`,
            branchAlias,
            100_000n,
          ]),
        ),
      ],
      100n,
    );

    expect(report.groups.map((group) => group.branchAlias)).toEqual([
      "Matriz",
      "Icaraima",
      "Big",
      "Hiper",
      "Tiradentes",
      "Atacado",
      "Castelo",
      "Multi Atacado",
      "Anchieta",
      "Loja adicional",
    ]);
  });
});
