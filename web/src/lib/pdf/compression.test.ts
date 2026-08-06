import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type PdfCompressionOptions,
  rasterizePdfForCompression,
} from "@/lib/pdf/compression";
import { renderPdfPageToPng } from "@/lib/pdf/render";

const temporaryDirectories: string[] = [];
const originalPdfRenderer = process.env.PDF_RENDERER;

async function createSourcePdf(filePath: string) {
  const document = await PDFDocument.create();
  for (let pageIndex = 1; pageIndex <= 2; pageIndex += 1) {
    const page = document.addPage([595, 842]);
    page.drawRectangle({
      x: 48,
      y: 520,
      width: 499,
      height: 240,
      color: rgb(pageIndex === 1 ? 0.1 : 0.8, 0.4, 0.7),
    });
    page.drawText(`Página ${pageIndex} para compactação`, {
      x: 64,
      y: 470,
      size: 22,
    });
  }
  await writeFile(filePath, await document.save());
}

function options(
  overrides: Partial<PdfCompressionOptions> = {},
): PdfCompressionOptions {
  return {
    quality: "BALANCED",
    method: "RASTER",
    dpi: 96,
    colorMode: "COLOR",
    imageQuality: 72,
    monochromeThreshold: 160,
    ...overrides,
  };
}

afterEach(async () => {
  process.env.PDF_RENDERER = originalPdfRenderer;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("PDF raster compression", () => {
  beforeEach(() => {
    if (process.env.PDF_POPPLER_PATH) {
      delete process.env.PDF_RENDERER;
    } else {
      process.env.PDF_RENDERER = "pdfjs";
    }
  });

  it("preserves page count and dimensions", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "perfect-pdf-compression-"),
    );
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "input.pdf");
    const outputPath = path.join(directory, "output.pdf");
    await createSourcePdf(inputPath);

    await rasterizePdfForCompression({
      inputPath,
      options: options(),
      outputPath,
    });

    const output = await PDFDocument.load(await readFile(outputPath));
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getWidth()).toBeCloseTo(595, 0);
    expect(output.getPage(0).getHeight()).toBeCloseTo(842, 0);
  });

  it("creates valid grayscale and one-bit monochrome documents", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "perfect-pdf-compression-"),
    );
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "input.pdf");
    await createSourcePdf(inputPath);

    for (const colorMode of ["GRAYSCALE", "MONOCHROME"] as const) {
      const outputPath = path.join(directory, `${colorMode}.pdf`);
      await rasterizePdfForCompression({
        inputPath,
        options: options({ colorMode, dpi: 72 }),
        outputPath,
      });
      const outputBytes = await readFile(outputPath);
      expect(outputBytes.subarray(0, 4).toString()).toBe("%PDF");
      expect((await PDFDocument.load(outputBytes)).getPageCount()).toBe(2);
    }
  });

  it("preserves page boxes and rotation", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "perfect-pdf-compression-"),
    );
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "geometry.pdf");
    const outputPath = path.join(directory, "geometry-compressed.pdf");
    const document = await PDFDocument.create();
    const page = document.addPage([400, 600]);
    page.setMediaBox(10, 20, 400, 600);
    page.setCropBox(30, 40, 350, 520);
    page.setBleedBox(20, 30, 370, 550);
    page.setTrimBox(25, 35, 360, 535);
    page.setArtBox(35, 45, 330, 500);
    page.setRotation(degrees(90));
    page.drawRectangle({ x: 80, y: 100, width: 180, height: 260, color: rgb(0, 0, 0) });
    await writeFile(inputPath, await document.save());

    await rasterizePdfForCompression({
      inputPath,
      options: options({ dpi: 72 }),
      outputPath,
    });

    const result = (await PDFDocument.load(await readFile(outputPath))).getPage(0);
    expect(result.getMediaBox()).toEqual(page.getMediaBox());
    expect(result.getCropBox()).toEqual(page.getCropBox());
    expect(result.getBleedBox()).toEqual(page.getBleedBox());
    expect(result.getTrimBox()).toEqual(page.getTrimBox());
    expect(result.getArtBox()).toEqual(page.getArtBox());
    expect(result.getRotation().angle).toBe(90);

    const [sourceRender, resultRender] = await Promise.all([
      renderPdfPageToPng({ dpi: 72, inputPath, pageNumber: 1 }),
      renderPdfPageToPng({ dpi: 72, inputPath: outputPath, pageNumber: 1 }),
    ]);
    const decode = (bytes: Uint8Array) =>
      sharp(bytes)
        .flatten({ background: "#ffffff" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const [sourcePixels, resultPixels] = await Promise.all([
      decode(sourceRender),
      decode(resultRender),
    ]);
    expect(resultPixels.info.width).toBe(sourcePixels.info.width);
    expect(resultPixels.info.height).toBe(sourcePixels.info.height);
    let absoluteError = 0;
    for (let index = 0; index < sourcePixels.data.length; index += 1) {
      absoluteError += Math.abs(
        sourcePixels.data[index]! - resultPixels.data[index]!,
      );
    }
    expect(absoluteError / sourcePixels.data.length).toBeLessThan(5);
  });

  it("keeps synthetic Form XObjects and soft-mask image content", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "perfect-pdf-compression-"),
    );
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "form-mask.pdf");
    const outputPath = path.join(directory, "form-mask-compressed.pdf");
    const formDocument = await PDFDocument.create();
    const formPage = formDocument.addPage([200, 200]);
    const rgba = Buffer.alloc(64 * 64 * 4);
    for (let index = 0; index < 64 * 64; index += 1) {
      rgba[index * 4] = 20;
      rgba[index * 4 + 1] = 40;
      rgba[index * 4 + 2] = 180;
      rgba[index * 4 + 3] = index % 64 < 48 ? 255 : 0;
    }
    const maskedPng = await sharp(rgba, {
      raw: { channels: 4, height: 64, width: 64 },
    })
      .png()
      .toBuffer();
    const maskedImage = await formDocument.embedPng(maskedPng);
    formPage.drawRectangle({ x: 10, y: 10, width: 180, height: 180, color: rgb(0.05, 0.05, 0.05) });
    formPage.drawImage(maskedImage, { x: 50, y: 50, width: 100, height: 100 });

    const document = await PDFDocument.create();
    const sourceForm = await PDFDocument.load(await formDocument.save());
    const embeddedForm = await document.embedPage(sourceForm.getPage(0));
    const page = document.addPage([400, 400]);
    page.drawPage(embeddedForm, { x: 50, y: 50, width: 300, height: 300 });
    await writeFile(inputPath, await document.save());

    await rasterizePdfForCompression({
      inputPath,
      options: options({ dpi: 96 }),
      outputPath,
    });

    const rendered = await renderPdfPageToPng({
      dpi: 72,
      inputPath: outputPath,
      pageNumber: 1,
    });
    const stats = await sharp(rendered).grayscale().stats();
    expect(stats.channels[0]!.min).toBeLessThan(64);
    expect((await PDFDocument.load(await readFile(outputPath))).getPageCount()).toBe(1);
  });

  it(
    "substantially reduces a high-resolution scanned page",
    async () => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "perfect-pdf-compression-"),
      );
      temporaryDirectories.push(directory);
      const inputPath = path.join(directory, "scan.pdf");
      const outputPath = path.join(directory, "scan-compressed.pdf");
      const pixels = Buffer.allocUnsafe(1_800 * 2_400 * 3);
      let seed = 0x1a2b3c4d;
      for (let index = 0; index < pixels.length; index += 1) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        pixels[index] = seed >>> 24;
      }
      const scan = await sharp(pixels, {
        raw: { width: 1_800, height: 2_400, channels: 3 },
      })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
      const document = await PDFDocument.create();
      const page = document.addPage([595, 842]);
      const image = await document.embedJpg(scan);
      page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
      await writeFile(inputPath, await document.save());

      await rasterizePdfForCompression({
        inputPath,
        options: options({ dpi: 96, imageQuality: 55, quality: "SCREEN" }),
        outputPath,
      });

      const [inputBytes, outputBytes] = await Promise.all([
        readFile(inputPath),
        readFile(outputPath),
      ]);
      expect(outputBytes.length).toBeLessThan(inputBytes.length * 0.6);
    },
    60_000,
  );
});
