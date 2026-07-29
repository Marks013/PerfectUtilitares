import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { convertPdfToDocx, convertPdfToXlsx } from "@/lib/pdf/office";
import { getPdfStorageRoot } from "@/lib/pdf/storage";

async function createTextPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 600]);
  page.drawText("Nome    Cargo", { font, size: 12, x: 40, y: 540 });
  page.drawText("Ana     Analista", { font, size: 12, x: 40, y: 510 });
  return document.save();
}

describe("PDF Office conversions", () => {
  it("creates DOCX and XLSX files from a text PDF", async () => {
    const jobId = `office-test-${Date.now()}`;
    const storageKey = `${jobId}/input/source.pdf`;
    const filePath = path.join(getPdfStorageRoot(), storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, await createTextPdf());

    try {
      const [docx, xlsx] = await Promise.all([
        convertPdfToDocx(storageKey),
        convertPdfToXlsx(storageKey),
      ]);
      expect(Buffer.from(docx).subarray(0, 2).toString("ascii")).toBe("PK");
      expect(Buffer.from(xlsx).subarray(0, 2).toString("ascii")).toBe("PK");
      expect(docx.byteLength).toBeGreaterThan(1_000);
      expect(xlsx.byteLength).toBeGreaterThan(1_000);
    } finally {
      await rm(path.join(getPdfStorageRoot(), jobId), {
        force: true,
        recursive: true,
      });
    }
  });
});
