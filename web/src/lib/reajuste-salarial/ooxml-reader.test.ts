import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readPayrollWorkbookSheets } from "./ooxml-reader";

function workbook(
  sheetXml =
    '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>Cadastro</t></is></c><c r="B2"><v>42</v></c><c r="C2"><v>00042</v></c></row></sheetData></worksheet>',
) {
  return Buffer.from(
    zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook xmlns:r="urn:r"><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Target="sheet1.xml"/></Relationships>',
      ),
      "xl/sheet1.xml": strToU8(
        sheetXml,
      ),
    }),
  );
}

describe("payroll OOXML reader", () => {
  it("reads inline strings and numbers while preserving row positions", () => {
    const sheets = readPayrollWorkbookSheets(workbook());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheet).toBe("Plan1");
    expect(sheets[0].data[1]).toEqual(["Cadastro", 42, "00042"]);
  });

  it("rejects extreme worksheet coordinates before creating sparse arrays", () => {
    expect(() =>
      readPayrollWorkbookSheets(
        workbook(
          '<worksheet><sheetData><row r="25001"><c r="A25001"><v>1</v></c></row></sheetData></worksheet>',
        ),
      ),
    ).toThrow("25.000 linhas");
    expect(() =>
      readPayrollWorkbookSheets(
        workbook(
          '<worksheet><sheetData><row r="1"><c r="SS1"><v>1</v></c></row></sheetData></worksheet>',
        ),
      ),
    ).toThrow("512 colunas");
  });
});
