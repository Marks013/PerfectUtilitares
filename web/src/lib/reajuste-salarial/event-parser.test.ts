import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseCompetencyFileName } from "./competency";
import { parseSalaryEventWorkbook } from "./event-parser";

const competency = parseCompetencyFileName("06-2026.xlsx");
function workbook(rows: unknown[][]): Buffer {
  const escapeXml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  function column(index: number): string { let result = ""; for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result; return result; }
  const xml = rows.map((row, index) => `<row r="${index + 1}">${row.map((cell, cellIndex) => cell == null ? "" : `<c r="${column(cellIndex)}${index + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`).join("")}</row>`).join("");
  return Buffer.from(zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  }));
}
function header(company = "EMPRESA TESTE"): unknown[][] { return [["0001", company, "Pág.:", "1"], ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"]]; }
function employee(events: unknown[][], registration = "0001"): unknown[][] { return [["Tipo:", "1", "Colaborador:", `${registration} - ANA TESTE`], ...events, ["INSS Proc:", "1.000,00"]]; }
const left = ["565", "01", "Bonus Convenc. SINDECOMU", null, "1,00", "80,00"];
const right = [null, null, null, null, null, null, null, null, "0901", "01", "Indenização Compensatória", null, "", null, "170,00"];
const parse = (rows: unknown[][]) => parseSalaryEventWorkbook(workbook(rows), competency, "06-2026.xlsx");

describe("detailed salary event import", () => {
  it("reads both sides, normalizes exact numeric codes and excludes summaries", async () => {
    const result = await parse([...header(), ...employee([left, right]), ["Resumo da filial"], left, right]);
    expect(result.company).toBe("1 - EMPRESA TESTE");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].events).toEqual({ "565": [{ paidCents: "8000", reference: "1,00", sourceRow: 5 }], "901": [{ paidCents: "17000", reference: "", sourceRow: 6 }] });
  });
  it("preserves employee events through page headers and retains duplicates for review", async () => {
    const result = await parse([...header(), ...employee([left, ...header(), left])]);
    expect(result.rows[0].events["565"]).toHaveLength(2);
  });
  it("reads either event on either column block", async () => {
    const result = await parse([...header(), ...employee([
      ["901", "01", "Indenização", null, "0", "255,00"],
      [null, null, null, null, null, null, null, null, "565", "01", "Bônus", null, "1", null, "80,00"],
    ])]);
    expect(result.rows[0].events["901"][0]).toMatchObject({ paidCents: "25500", reference: "0" });
    expect(result.rows[0].events["565"][0]).toMatchObject({ paidCents: "8000", reference: "1" });
  });
  it("ignores event names with another numeric code", async () => {
    const result = await parse([...header(), ...employee([["1565", "01", "Bonus Convenc. SINDECOMU", null, "1", "80,00"]])]);
    expect(result.rows[0].events["565"]).toEqual([]);
  });
  it("imports zero and absence without inventing events", async () => {
    const result = await parse([...header(), ...employee([["565", "01", "Bônus", null, "0", "0,00"]]), ...employee([], "2")]);
    expect(result.rows[0].events["565"][0].paidCents).toBe("0");
    expect(result.rows[1].events).toEqual({ "565": [], "901": [] });
  });
  it("rejects a tabular INSS report without event evidence", async () => {
    await expect(parse([["Apelido:", "MATRIZ"], ["Cadastro", "Nome do Colaborador", "INSS Normal"]])).rejects.toThrow(/detalhada/);
  });
  it("rejects mixed companies, missing closures and duplicate registrations", async () => {
    await expect(parse([...header(), ...employee([left, ...header("OUTRA EMPRESA")])])).rejects.toThrow(/empresas diferentes/);
    await expect(parse([...header(), ["Colaborador:", "1 - ANA TESTE"], left])).rejects.toMatchObject({ code: "REAJUSTE_STRUCTURE_INVALID", diagnostics: [expect.objectContaining({ message: expect.stringMatching(/fechamento/) })] });
    await expect(parse([...header(), ...employee([]), ...employee([], "1")])).rejects.toThrow(/mais de uma vez/);
  });
  it.each([["565", "02", "Bônus", null, "1", "80,00"], ["565", "01", "Bônus", null, "1", "inválido"]].map((row) => [row]))("rejects unsafe event type or value", async (row) => {
    await expect(parse([...header(), ...employee([row])])).rejects.toThrow();
  });
});
