import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  UnimedXlsxSecurityError,
  validateUnimedXlsxArchive,
} from "./xlsx-security";

function workbook(extra: Record<string, Uint8Array> = {}) {
  return Buffer.from(
    zipSync(
      {
        "[Content_Types].xml": strToU8("<Types/>"),
        "_rels/.rels": strToU8("<Relationships/>"),
        "xl/workbook.xml": strToU8("<workbook/>"),
        "xl/_rels/workbook.xml.rels": strToU8("<Relationships/>"),
        "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
        ...extra,
      },
      { level: 6 },
    ),
  );
}

describe("Unimed XLSX archive security", () => {
  it("accepts a bounded XLSX ZIP with required structures", () => {
    const result = validateUnimedXlsxArchive(workbook());

    expect(result.entryCount).toBe(5);
    expect(result.totalCompressedBytes).toBeGreaterThan(0);
    expect(result.totalUncompressedBytes).toBeGreaterThan(0);
  });

  it("rejects invalid signatures and missing workbook structures", () => {
    expect(() =>
      validateUnimedXlsxArchive(Buffer.from("not-a-zip")),
    ).toThrow(UnimedXlsxSecurityError);

    const missing = Buffer.from(
      zipSync({ "readme.txt": strToU8("not a workbook") }),
    );
    expect(() => validateUnimedXlsxArchive(missing)).toThrow(
      /estruturas obrigatorias|estruturas obrigatórias/,
    );
  });

  it("rejects path traversal and suspicious internal paths", () => {
    expect(() =>
      validateUnimedXlsxArchive(
        workbook({ "../outside.xml": strToU8("<xml/>") }),
      ),
    ).toThrow(/caminho interno/);
  });

  it("rejects encrypted central-directory entries", () => {
    const bytes = workbook();
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const centralOffset = bytes.indexOf(centralSignature);
    expect(centralOffset).toBeGreaterThan(0);
    bytes.writeUInt16LE(
      bytes.readUInt16LE(centralOffset + 8) | 0x0001,
      centralOffset + 8,
    );

    expect(() => validateUnimedXlsxArchive(bytes)).toThrow(/criptografado/);
  });
});
