import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPdfPageToPng, renderPdfPagesToPng } from "./render";

let directory: string;
let inputPath: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "perfect-png-limits-"));
  inputPath = path.join(directory, "source.pdf");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

describe.each(["pdfjs", "poppler"])("PNG safety with %s", (renderer) => {
  beforeEach(() => vi.stubEnv("PDF_RENDERER", renderer));

  it.each([
    { width: 9_000, height: 100, unit: 1 },
    { width: 6_500, height: 6_500, unit: 1 },
    { width: 100, height: 100, unit: 100 },
  ])("rejects unsafe dimensions before allocating a canvas: %o", async ({ width, height, unit }) => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([width, height]);
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
    await writeFile(inputPath, await pdf.save());
    await expect(renderPdfPageToPng({ inputPath, pageNumber: 1, dpi: 72 }))
      .rejects.toMatchObject({ code: "PDF_IMAGE_TOO_LARGE" });
    await expect(renderPdfPagesToPng({ inputPath, pageNumbers: [1], dpi: 72 }))
      .rejects.toMatchObject({ code: "PDF_IMAGE_TOO_LARGE" });
  });

  it("rejects a batch whose combined pixel allocation is unsafe", async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 4; index += 1) pdf.addPage([5_000, 5_000]);
    await writeFile(inputPath, await pdf.save());
    await expect(renderPdfPagesToPng({ inputPath, pageNumbers: [1, 2, 3, 4], dpi: 72 }))
      .rejects.toMatchObject({ code: "PDF_RENDER_BATCH_TOO_LARGE" });
  });

  it("still renders normal pages in a deduplicated ordered batch", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 150]);
    pdf.addPage([120, 160]);
    await writeFile(inputPath, await pdf.save());
    const pages = await renderPdfPagesToPng({ inputPath, pageNumbers: [2, 1, 2], dpi: 72 });
    expect([...pages.keys()]).toEqual([1, 2]);
    expect(await sharp(pages.get(1)).metadata()).toMatchObject({ width: 100, height: 150 });
    expect(await sharp(pages.get(2)).metadata()).toMatchObject({ width: 120, height: 160 });
  });
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, 601])("rejects invalid PNG DPI %s before reading the PDF", async (dpi) => {
  await expect(renderPdfPageToPng({ inputPath, pageNumber: 1, dpi }))
    .rejects.toMatchObject({ code: "INVALID_IMAGE_OPTIONS" });
});
