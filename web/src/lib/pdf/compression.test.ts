import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  type PdfCompressionOptions,
  rasterizePdfForCompression,
} from "@/lib/pdf/compression";

const temporaryDirectories: string[] = [];

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
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("PDF raster compression", () => {
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
    20_000,
  );
});
