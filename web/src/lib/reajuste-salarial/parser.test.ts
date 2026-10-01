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
  function monthlyBlock(registration = "0001", base: unknown = "4.560,84") {
    return [
      ["FOLHA DE PAGAMENTO"],
      ["Local:", "01  MATRIZ"],
      ["Tipo:", "1", "Colaborador:", `${registration} - ANA TESTE`],
      ["Cargo:", "1 - EXEMPLO", null, "Salário Base:", 3270.96],
      ["Totais:", "Proventos:", "4.640,84"],
      [null, "Bases IRRF Proc:", "0,00", null, null, "FGTS Proc:", "9.999,99", null, null, "INSS Proc:", base, null, null, "IPE Proc:", "0,00"],
    ];
  }

  it("reads monthly payroll INSS Proc instead of salary, earnings or FGTS", () => {
    const parsed = parsePayrollSheetRows(monthlyBlock(), context);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ registration: "1", employeeName: "ANA TESTE", branchAlias: "MATRIZ", baseCents: 456084n, sourceRow: 3 });
  });

  it("reads repeated monthly locations and zero bases, ignoring aggregate totals", () => {
    const rows = [...monthlyBlock(), ...monthlyBlock("0002", 0), ["INSS Mês:", "999.999,99"], ["INSS 13º:", "999.999,99"]];
    rows[7] = ["Local:", "02 - LOJA B"];
    expect(parsePayrollSheetRows(rows, context).map(({ branchAlias, baseCents }) => ({ branchAlias, baseCents }))).toEqual([
      { branchAlias: "MATRIZ", baseCents: 456084n },
      { branchAlias: "LOJA B", baseCents: 0n },
    ]);
  });

  it("rejects duplicate monthly registrations after removing leading zeros", () => {
    expect(() => parsePayrollSheetRows([...monthlyBlock(), ...monthlyBlock("1")], context)).toThrow(/mais de uma vez/);
  });

  it.each([undefined, "", "inválido"])("rejects monthly invalid INSS Proc %s without salary fallback", (base) => {
    const rows = monthlyBlock();
    rows[5][10] = base;
    expect(() => parsePayrollSheetRows(rows, context)).toThrow();
  });

  it("rejects monthly employees without a closing base or location", () => {
    expect(() => parsePayrollSheetRows(monthlyBlock().slice(0, -1), context)).toThrow();
    expect(() => parsePayrollSheetRows(monthlyBlock().filter((_, index) => index !== 1), context)).toThrow();
    expect(() => parsePayrollSheetRows([...monthlyBlock().slice(0, -1), ...monthlyBlock("2")], context)).toThrow();
  });

  it("preserves the employee through repeated page headers and rejects a changed location", () => {
    const rows = monthlyBlock();
    const page = [["0001", "EMPRESA EXEMPLO", "Pág.:", 2], ["FOLHA DE PAGAMENTO"], ["Período:", 46174, "a", 46203], ["Local:", "01  MATRIZ"]];
    expect(parsePayrollSheetRows([...rows.slice(0, 5), ...page, rows[5]], context)[0].baseCents).toBe(456084n);
    page[3] = ["Local:", "02  LOJA B"];
    expect(() => parsePayrollSheetRows([...rows.slice(0, 5), ...page, rows[5]], context)).toThrow();
  });

  it("rejects an extra INSS Proc closing row without an employee", () => {
    const rows = monthlyBlock();
    expect(() => parsePayrollSheetRows([...rows, rows[5]], context)).toThrow();
  });

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
      registration: "1",
      branchAlias: "MATRIZ",
      baseCents: 456_084n,
    });
    expect(parsed[1].registration).toBe("10");
    expect(parsed[1].baseCents).toBe(0n);
  });

  it("normalizes leading zeroes before rejecting duplicate registrations", () => {
    expect(() =>
      parsePayrollSheetRows(
        block("MATRIZ", [
          ["0001", "ANA", null, null, "1,00"],
          ["1", "ANA", null, null, "1,00"],
        ]),
        context,
      ),
    ).toThrow(/mais de uma vez/);
  });

  it("keeps an all-zero registration as zero and rejects numeric registrations", () => {
    expect(
      parsePayrollSheetRows(
        block("MATRIZ", [["000000000", "ANA", null, null, "1,00"]]),
        context,
      )[0]?.registration,
    ).toBe("0");
    expect(() =>
      parsePayrollSheetRows(
        block("MATRIZ", [[1, "ANA", null, null, "1,00"]]),
        context,
      ),
    ).toThrow(/relatório de INSS/);
  });
});
