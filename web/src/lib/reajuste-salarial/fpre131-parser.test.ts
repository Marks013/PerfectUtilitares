import { describe, expect, it } from "vitest";
import { parseFpre131SheetRows } from "./fpre131-parser";

const context = { sourceFile: "FPRE131.xlsx", sourceSheet: "Plan1" };

function header() {
  return ["Cadastro", "Nome", null, null, null, "Admissão", "Cargo", null, null, "Salário"];
}

describe("FPRE131 parser", () => {
  it("reads numeric and padded registrations across repeated headers", () => {
    const rows = [
      [1, "-", "EMPRESA"],
      header(),
      ["01 , MATRIZ"],
      [7274, "ADEMAR", null, null, null, 45_748, "AUXILIAR", null, null, "3.270,96"],
      [1, "-", "EMPRESA"],
      header(),
      ["000000236", "DENILSON", null, null, null, 35_479, "ESCRITORIO", null, null, "4.970,90"],
      ["07 , HIPERMERCADO"],
      [4, "CLEUSA", null, null, null, 33_147, "CAIXA", null, null, "2.031,94"],
      ["11 , CASTELO BRANCO"],
      [9, "ANA", null, null, null, 46_000, "CAIXA", null, null, 1745.7],
    ];
    const parsed = parseFpre131SheetRows(rows, context);
    expect(parsed.map((employee) => employee.registration)).toEqual([
      "7274",
      "236",
      "4",
      "9",
    ]);
    expect(parsed.map((employee) => employee.branchAlias)).toEqual([
      "Matriz",
      "Matriz",
      "Hiper",
      "Castelo",
    ]);
    expect(parsed.map((employee) => employee.currentSalaryCents)).toEqual([
      327_096n,
      497_090n,
      203_194n,
      174_570n,
    ]);
  });

  it("rejects duplicate registrations after normalization", () => {
    expect(() =>
      parseFpre131SheetRows(
        [
          header(),
          ["01 , MATRIZ"],
          ["0004", "ANA", null, null, null, 1, "CAIXA", null, null, "2.031,94"],
          [4, "ANA", null, null, null, 1, "CAIXA", null, null, "2.031,94"],
        ],
        context,
      ),
    ).toThrow("aparece mais de uma vez");
  });

  it("rejects partial employee rows instead of silently dropping them", () => {
    expect(() =>
      parseFpre131SheetRows(
        [header(), ["01 , MATRIZ"], [4, "ANA", null, null, null, 1, "CAIXA"]],
        context,
      ),
    ).toThrow("não corresponde ao relatório FPRE131");
  });
});
