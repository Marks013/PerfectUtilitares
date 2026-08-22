import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { parsePayrollSheetRows } from "./parser";

const competency = parseCompetencyFileName("06-2026.xlsx");
const context = {
  competency,
  sourceFile: "06-2026.xlsx",
  sourceSheet: "Plan1",
};

function block(alias: string, rows: unknown[][]) {
  return [
    ["Filial:", "0001"],
    ["Apelido:", alias],
    [null, null, null, null, "INSS Normal", null, null, null, "INSS 13º Salário"],
    ["Cadastro", "Nome do Colaborador", null, null, "Base", null, null, null, "Base"],
    ...rows,
    ["Total colaboradores:", rows.length],
  ];
}

describe("payroll XLSX parser", () => {
  it("reads repeated branch blocks and ignores the thirteenth salary Base", () => {
    const rows = [
      ...block("MATRIZ", [
        ["000000001", "COLABORADOR EXEMPLO", null, null, "4.560,84", null, null, null, "9.999,99"],
      ]),
      ...block("LOJA B", [
        ["000000010", "ANA TESTE", null, null, 0, null, null, null, "1.000,00"],
      ]),
    ];
    const parsed = parsePayrollSheetRows(rows, context);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      registration: "000000001",
      branchAlias: "MATRIZ",
      baseCents: 456_084n,
    });
    expect(parsed[1].baseCents).toBe(0n);
  });

  it("rejects duplicate registrations and numeric registrations", () => {
    expect(() =>
      parsePayrollSheetRows(
        block("MATRIZ", [
          ["0001", "ANA", null, null, "1,00"],
          ["0001", "ANA", null, null, "1,00"],
        ]),
        context,
      ),
    ).toThrow(/mais de uma vez/);
    expect(() =>
      parsePayrollSheetRows(
        block("MATRIZ", [[1, "ANA", null, null, "1,00"]]),
        context,
      ),
    ).toThrow(/relatório de INSS/);
  });
});
