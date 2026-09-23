import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPdfPagesToJpeg, renderPdfPageToPng } from "@/lib/pdf/render";
import type { PdfManifest } from "@/lib/pdf/schema";

let directory: string;
let inputPath: string;
const storageKey = "job/input/source.pdf";
const inputs = new Map([["source", { id: "source", originalName: "source.pdf", storageKey }]]);
const instruction: PdfManifest["pages"][number] = {
  id: "page", artifactId: "source", sourcePage: 1, rotation: 0,
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "perfect-jpeg-regression-"));
  vi.stubEnv("PDF_STORAGE_DIR", directory);
  inputPath = path.join(directory, storageKey);
  await mkdir(path.dirname(inputPath), { recursive: true });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function createSource() {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(0, 0, 1) });
  page.drawRectangle({ x: 70, y: 50, width: 40, height: 30, color: rgb(1, 0, 0) });
  page.setCropBox(50, 40, 100, 80);
  page.setRotation(degrees(90));
  await writeFile(inputPath, await document.save());
}

async function convert(page = instruction, dpi = 144) {
  let result: Uint8Array | undefined;
  await renderPdfPagesToJpeg({
    inputs, manifest: { version: 1, pages: [page] }, dpi,
    onOutput(_page, bytes) { result = bytes; },
  });
  if (!result) throw new Error("No JPEG output");
  return result;
}

describe.each(["pdfjs", "poppler"])("JPEG using %s", (renderer) => {
  beforeEach(() => {
    vi.stubEnv("PDF_RENDERER", renderer);
  });

  it("uses the source CropBox and source rotation", async () => {
    await createSource();
    const metadata = await sharp(await convert()).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 160, height: 200, density: 144, chromaSubsampling: "4:4:4" });
  });

  it("applies manifest crop relative to CropBox and combines rotations", async () => {
    await createSource();
    const bytes = await convert({ ...instruction, rotation: 180, crop: { x: 20, y: 10, width: 40, height: 30 } });
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ width: 60, height: 80 });
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // All corners and the center must show the selected red region, not blue margins.
    for (const [x, y] of [[4, 4], [55, 4], [4, 75], [55, 75], [30, 40]]) {
      const offset = (y * info.width + x) * info.channels;
      expect(data[offset]).toBeGreaterThan(240);
      expect(data[offset + 1]).toBeLessThan(15);
      expect(data[offset + 2]).toBeLessThan(15);
    }
  });

  it("retains existing PNG dimensions for compression callers", async () => {
    await createSource();
    const bytes = await renderPdfPageToPng({ inputPath, pageNumber: 1, dpi: 144 });
    expect(await sharp(bytes).metadata()).toMatchObject(renderer === "poppler"
      ? { width: 400, height: 600 }
      : { width: 160, height: 200 });
  });

  it.each([[10_000, 100], [6_000, 7_000]])("rejects oversized raster pages %s x %s before producing output", async (width, height) => {
    const document = await PDFDocument.create();
    document.addPage([width, height]);
    await writeFile(inputPath, await document.save());
    await expect(convert(instruction, 72)).rejects.toMatchObject({ code: "PDF_IMAGE_TOO_LARGE" });
  });

  it("preserves manifest order, duplicates, and page-specific rotations", async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 50]);
    document.addPage([80, 40]);
    await writeFile(inputPath, await document.save());
    const results: Array<{ id: string; index: number; width?: number; height?: number }> = [];
    await renderPdfPagesToJpeg({
      inputs, dpi: 72,
      manifest: { version: 1, pages: [
        { ...instruction, id: "second", sourcePage: 2, rotation: 90 },
        instruction,
        { ...instruction, id: "duplicate", rotation: 90 },
      ] },
      async onOutput(page, bytes, index) {
        const { width, height } = await sharp(bytes).metadata();
        results.push({ id: page.id, index, width, height });
      },
    });
    expect(results).toEqual([
      { id: "second", index: 0, width: 40, height: 80 },
      { id: "page", index: 1, width: 100, height: 50 },
      { id: "duplicate", index: 2, width: 50, height: 100 },
    ]);
  });

  it("rejects an invalid crop instead of silently converting the full page", async () => {
    await createSource();
    await expect(convert({ ...instruction, crop: { x: 90, y: 0, width: 30, height: 20 } })).rejects.toMatchObject({ code: "INVALID_CROP" });
  });
});

it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 301])("rejects invalid DPI %s", async (dpi) => {
  await expect(convert(instruction, dpi)).rejects.toMatchObject({ code: "INVALID_IMAGE_OPTIONS" });
});
