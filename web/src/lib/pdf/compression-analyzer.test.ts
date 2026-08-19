import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzePdfCompressionProfile,
  parsePdfImagesList,
  selectCompressionSamplePages,
} from "@/lib/pdf/compression-analyzer";

const temporaryDirectories: string[] = [];
const RGB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFUlEQVR4nGP8//8/A27AhEduBEsDAKXjAxF9kqZqAAAAAElFTkSuQmCC",
  "base64",
);

afterEach(async () => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { force: true, recursive: true });
  }
});

async function makeSyntheticPdf(options: {
  image?: boolean;
  text?: boolean;
}) {
  const directory = await mkdtemp(join(tmpdir(), "pdf-compression-analyzer-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "input.pdf");
  const document = await PDFDocument.create();
  const page = document.addPage([72, 72]);

  if (options.image) {
    const image = await document.embedPng(RGB_PNG);
    page.drawImage(image, { x: 0, y: 0, width: 72, height: 72 });
  }

  if (options.text) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("OCR selectable text 1234567890", {
      x: 2,
      y: 2,
      size: 5,
      font,
    });
  }

  await writeFile(path, await document.save());
  return path;
}

async function withFakePdfImages<T>(
  output: string,
  callback: () => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "fake-pdfimages-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "pdfimages");
  const script = `#!/bin/sh
cat <<'PERFECT_PDFIMAGES_EOF'
${output}
PERFECT_PDFIMAGES_EOF
`;
  await writeFile(executable, script, { mode: 0o755 });

  const previousPath = process.env.PATH;
  process.env.PATH = previousPath
    ? `${directory}${delimiter}${previousPath}`
    : directory;
  try {
    return await callback();
  } finally {
    process.env.PATH = previousPath;
  }
}

const PDFIMAGES_HEADER = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------`;

describe("server PDF compression analyzer", () => {
  it("samples small and large documents deterministically", () => {
    expect(selectCompressionSamplePages(3)).toEqual([1, 2, 3]);
    expect(selectCompressionSamplePages(185)).toEqual([1, 46, 93, 139, 185]);
  });

  it("parses valid Poppler rows and skips malformed rows", () => {
    const rows = parsePdfImagesList(`
${PDFIMAGES_HEADER}
   1     0 image    1700  2200  gray    1   1  jbig2  no       10  0   200   200  24K  0.5%
 bad     1 image       0  2200  rgb     3   8  jpeg   no       11  0   300   300  10K  0.2%
  46     2 image    1700  2200  gray    1   1  ccitt  no       44  0   200   200  28K  0.6%
`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      page: 1,
      width: 1700,
      height: 2200,
      bitsPerComponent: 1,
      encoding: "jbig2",
      xPpi: 200,
      yPpi: 200,
    });
    expect(rows[1]?.encoding).toBe("ccitt");
  });

  it("classifies a full-page image with selectable OCR text as SCANNED_OCR without requiring host Poppler", async () => {
    const path = await makeSyntheticPdf({ image: true, text: true });
    const output = `${PDFIMAGES_HEADER}
   1     0 image     200   200  rgb     3   8  jpeg   no       10  0   200   200  24K  0.5%`;

    const profile = await withFakePdfImages(output, () =>
      analyzePdfCompressionProfile(path),
    );

    expect(profile).toMatchObject({
      pageCount: 1,
      sampledPages: [1],
      contentKind: "SCANNED_OCR",
      colorMode: "COLOR",
      sourceDpi: 200,
      minimumDpi: 200,
      maximumDpi: 200,
      hasSelectableText: true,
      hasOcrLayer: true,
      fullPageImageRatio: 1,
      imageCoverageRatio: 1,
      imageCount: 1,
      predominantImageEncoding: "JPEG",
      bitsPerComponent: 8,
      alreadyOptimized: true,
      optimizationClass: "OPTIMIZED_JPEG",
    });
  });

  it("detects an already optimized monochrome scan", async () => {
    const path = await makeSyntheticPdf({ image: true, text: true });
    const output = `${PDFIMAGES_HEADER}
   1     0 image     200   200  gray    1   1  jbig2  no       10  0   200   200  24K  0.5%`;

    const profile = await withFakePdfImages(output, () =>
      analyzePdfCompressionProfile(path),
    );

    expect(profile).toMatchObject({
      contentKind: "SCANNED_OCR",
      colorMode: "MONOCHROME",
      sourceDpi: 200,
      predominantImageEncoding: "JBIG2",
      bitsPerComponent: 1,
      alreadyOptimized: true,
      optimizationClass: "OPTIMIZED_MONO",
    });
  });

  it("classifies partial image coverage as MIXED", async () => {
    const path = await makeSyntheticPdf({ image: true, text: true });
    const output = `${PDFIMAGES_HEADER}
   1     0 image     100   100  gray    1   8  flate  no       10  0   200   200  24K  0.5%`;

    const profile = await withFakePdfImages(output, () =>
      analyzePdfCompressionProfile(path),
    );

    expect(profile.contentKind).toBe("MIXED");
    expect(profile.fullPageImageRatio).toBe(0);
    expect(profile.imageCoverageRatio).toBeCloseTo(0.25, 5);
    expect(profile.predominantImageEncoding).toBe("FLATE");
    expect(profile.colorMode).toBe("GRAYSCALE");
  });

  it("classifies a text-only PDF as VECTOR without requiring host Poppler", async () => {
    const path = await makeSyntheticPdf({ text: true });
    const profile = await withFakePdfImages(PDFIMAGES_HEADER, () =>
      analyzePdfCompressionProfile(path),
    );

    expect(profile).toMatchObject({
      pageCount: 1,
      contentKind: "VECTOR",
      hasSelectableText: true,
      hasOcrLayer: false,
      imageCount: 0,
      predominantImageEncoding: null,
      bitsPerComponent: null,
      sourceDpi: null,
      minimumDpi: null,
      maximumDpi: null,
    });
  });

  it("returns analyzer-unavailable when pdfimages cannot be spawned", async () => {
    const path = await makeSyntheticPdf({ text: true });
    const previousPath = process.env.PATH;
    process.env.PATH = "/definitely-not-a-real-bin-directory";
    try {
      await expect(analyzePdfCompressionProfile(path)).rejects.toMatchObject({
        code: "PDF_ANALYZER_UNAVAILABLE",
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
