import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  prepareXlsxArchive,
  validateXlsxArchive,
  XlsxSecurityError,
} from "./xlsx-security";

function workbook(extra: Record<string, Uint8Array> = {}) {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "_rels/.rels": strToU8("<Relationships/>"),
      "xl/workbook.xml": strToU8("<workbook/>"),
      "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
      ...extra,
    }),
  );
}

describe("shared XLSX archive security", () => {
  it("accepts a bounded workbook", () => {
    expect(validateXlsxArchive(workbook()).entryCount).toBe(4);
  });

  it("supports stricter limits for sensitive import routes", () => {
    expect(() =>
      validateXlsxArchive(workbook(), {
        maxEntryUncompressedBytes: 8,
        maxTotalUncompressedBytes: 32,
      }),
    ).toThrow(/limite/);
  });

  it("normalizes legacy Windows separators after validating the archive", () => {
    const legacy = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "_rels\\.rels": strToU8("<Relationships/>"),
        "xl\\workbook.xml": strToU8("<workbook/>"),
        "xl\\sheet1.xml": strToU8("<worksheet/>"),
      }),
    );
    const prepared = prepareXlsxArchive(legacy, { strict: true });
    expect(validateXlsxArchive(prepared).usesLegacyPathSeparators).toBe(false);
  });

  it("rejects unsafe paths and strict-profile content", () => {
    expect(() =>
      validateXlsxArchive(workbook({ "../outside.xml": strToU8("x") })),
    ).toThrow(XlsxSecurityError);
    expect(() =>
      validateXlsxArchive(workbook({ "..\\outside.xml": strToU8("x") })),
    ).toThrow(XlsxSecurityError);
    expect(() =>
      validateXlsxArchive(
        workbook({ "xl/vbaProject.bin": strToU8("macro") }),
        { strict: true },
      ),
    ).toThrow(/macros/);
    expect(() =>
      validateXlsxArchive(
        workbook({ "xl/externalLinks/externalLink1.xml": strToU8("link") }),
        { strict: true },
      ),
    ).toThrow(/links externos/);
  });
});
