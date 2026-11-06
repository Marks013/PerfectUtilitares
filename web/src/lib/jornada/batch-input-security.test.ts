import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseJornadaBatchXlsx } from "./batch-input";

async function workbook(sheet: string) {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("Jornada XLSX resource limits", () => {
  // Creating and inflating a 16 MiB DEFLATE fixture can exceed Vitest's
  // default timeout under parallel coverage; keep the security assertion unchanged.
  it("aborts an XML stream that inflates past the allowed size", { timeout: 15_000 }, async () => {
    const zip = await workbook("<worksheet>" + " ".repeat(16 * 1024 * 1024) + "</worksheet>");
    expect(zip.length).toBeLessThan(32 * 1024);
    await expect(parseJornadaBatchXlsx(zip)).rejects.toThrow("16 MB descompactados");
  });

  it.each([
    ["4294967295", "A1", "índice de linha"],
    ["3", "XFE3", "índice de coluna"],
    ["3", "ZZZZZZZZ3", "referência de célula"],
  ])("rejects row %s and cell %s before allocating a sparse array", async (row, cell, error) => {
    const zip = await workbook(
      `<worksheet><sheetData><row r="${row}"><c r="${cell}"><v>1</v></c></row></sheetData></worksheet>`,
    );
    await expect(parseJornadaBatchXlsx(zip)).rejects.toThrow(error);
  });

  it("keeps valid sparse positions at Excel's row and column boundaries", async () => {
    const zip = await workbook(
      '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
    );
    const { rows } = await parseJornadaBatchXlsx(zip);
    expect(rows[1_048_575]?.[16_383]).toBe(1);
  });
});
