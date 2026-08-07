import { readFile, writeFile } from "node:fs/promises";
import { degrees, PDFDocument, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { renderPdfPageToPng } from "@/lib/pdf/render";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";
import {
  PdfToolError,
  type PdfCompressionOptions,
} from "./compression-types";

type PdfPageBox = ReturnType<PDFPage["getMediaBox"]>;

type PdfPageGeometry = {
  artBox: PdfPageBox;
  bleedBox: PdfPageBox;
  cropBox: PdfPageBox;
  mediaBox: PdfPageBox;
  rotation: number;
  trimBox: PdfPageBox;
};

function readPageGeometry(page: PDFPage): PdfPageGeometry {
  return {
    artBox: page.getArtBox(),
    bleedBox: page.getBleedBox(),
    cropBox: page.getCropBox(),
    mediaBox: page.getMediaBox(),
    rotation: ((page.getRotation().angle % 360) + 360) % 360,
    trimBox: page.getTrimBox(),
  };
}

function setPageBox(
  setter: (x: number, y: number, width: number, height: number) => void,
  box: PdfPageBox,
) {
  setter(box.x, box.y, box.width, box.height);
}

function applyPageGeometry(page: PDFPage, geometry: PdfPageGeometry) {
  setPageBox(page.setMediaBox.bind(page), geometry.mediaBox);
  setPageBox(page.setCropBox.bind(page), geometry.cropBox);
  setPageBox(page.setBleedBox.bind(page), geometry.bleedBox);
  setPageBox(page.setTrimBox.bind(page), geometry.trimBox);
  setPageBox(page.setArtBox.bind(page), geometry.artBox);
  page.setRotation(degrees(geometry.rotation));
}

function readPixelByte(buffer: Buffer, index: number) {
  const value = buffer[index];

  if (value === undefined) {
    throw new PdfToolError(
      "PDF_VISUAL_INTEGRITY_FAILED",
      "Os dados renderizados do PDF estão incompletos.",
    );
  }

  return value;
}

async function assertVisualCompleteness({
  candidateBytes,
  colorMode,
  monochromeThreshold,
  sourceBytes,
}: Pick<PdfCompressionOptions, "colorMode" | "monochromeThreshold"> & {
  candidateBytes: Buffer;
  sourceBytes: Buffer;
}) {
  const normalize = (bytes: Buffer) =>
    sharp(bytes, { failOn: "error" })
      .flatten({ background: "#FFFFFF" })
      .resize(256, 256, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
  const [source, candidate] = await Promise.all([
    normalize(sourceBytes),
    normalize(candidateBytes),
  ]);
  const sourceContentThreshold =
    colorMode === "MONOCHROME"
      ? Math.max(64, 255 - monochromeThreshold + 16)
      : 48;
  const toleratedMissingRatio = colorMode === "MONOCHROME" ? 0.08 : 0.015;
  let sourceContentPixels = 0;
  let missingPixels = 0;

  for (let index = 0; index < source.length; index += 3) {
    const sourceDistance = Math.max(
      255 - readPixelByte(source, index),
      255 - readPixelByte(source, index + 1),
      255 - readPixelByte(source, index + 2),
    );
    if (sourceDistance < sourceContentThreshold) continue;
    sourceContentPixels += 1;
    const candidateDistance = Math.max(
      255 - readPixelByte(candidate, index),
      255 - readPixelByte(candidate, index + 1),
      255 - readPixelByte(candidate, index + 2),
    );
    if (candidateDistance < 8) missingPixels += 1;
  }

  if (
    sourceContentPixels >= 64 &&
    missingPixels / sourceContentPixels > toleratedMissingRatio
  ) {
    throw new PdfToolError(
      "PDF_VISUAL_INTEGRITY_FAILED",
      "A recompressão visual omitiu conteúdo da página e foi descartada.",
    );
  }
}

function samePageBox(left: PdfPageBox, right: PdfPageBox) {
  return (["x", "y", "width", "height"] as const).every(
    (key) => Math.abs(left[key] - right[key]) < 0.01,
  );
}

async function assertVisualEquivalence(
  sourceBytes: Buffer,
  candidateBytes: Buffer,
) {
  const normalize = (bytes: Buffer) =>
    sharp(bytes, { failOn: "error" })
      .flatten({ background: "#FFFFFF" })
      .resize(256, 256, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
  const [source, candidate] = await Promise.all([
    normalize(sourceBytes),
    normalize(candidateBytes),
  ]);
  if (source.length !== candidate.length) {
    throw new PdfToolError(
      "PDF_STRUCTURAL_INTEGRITY_FAILED",
      "A compactação alterou as dimensões dos dados renderizados.",
    );
  }

  let absoluteError = 0;
  let stronglyDifferent = 0;
  for (let index = 0; index < source.length; index += 1) {
    const difference = Math.abs(
      readPixelByte(source, index) - readPixelByte(candidate, index),
    );
    absoluteError += difference;
    if (difference > 16) stronglyDifferent += 1;
  }
  const meanAbsoluteError = absoluteError / source.length;
  const strongDifferenceRatio = stronglyDifferent / source.length;
  if (meanAbsoluteError > 1.5 || strongDifferenceRatio > 0.005) {
    throw new PdfToolError(
      "PDF_STRUCTURAL_INTEGRITY_FAILED",
      "A compactação sem perdas alterou o conteúdo visual e foi descartada.",
    );
  }
}

export async function validateStructuralCandidate(
  inputPath: string,
  candidatePath: string,
) {
  const [source, candidate] = await Promise.all([
    PDFDocument.load(await readFile(inputPath), { updateMetadata: false }),
    PDFDocument.load(await readFile(candidatePath), { updateMetadata: false }),
  ]);
  if (source.getPageCount() !== candidate.getPageCount()) {
    throw new PdfToolError(
      "PDF_STRUCTURAL_INTEGRITY_FAILED",
      "A compactação alterou a quantidade de páginas e foi descartada.",
    );
  }

  for (let pageIndex = 0; pageIndex < source.getPageCount(); pageIndex += 1) {
    const sourceGeometry = readPageGeometry(source.getPage(pageIndex));
    const candidateGeometry = readPageGeometry(candidate.getPage(pageIndex));
    const boxesMatch = (
      ["mediaBox", "cropBox", "bleedBox", "trimBox", "artBox"] as const
    ).every((box) =>
      samePageBox(sourceGeometry[box], candidateGeometry[box]),
    );
    if (
      !boxesMatch ||
      sourceGeometry.rotation !== candidateGeometry.rotation
    ) {
      throw new PdfToolError(
        "PDF_STRUCTURAL_INTEGRITY_FAILED",
        "A compactação alterou a geometria das páginas e foi descartada.",
      );
    }
    const [sourcePage, candidatePage] = await Promise.all([
      renderPdfPageToPng({
        dpi: 72,
        inputPath,
        pageNumber: pageIndex + 1,
      }),
      renderPdfPageToPng({
        dpi: 72,
        inputPath: candidatePath,
        pageNumber: pageIndex + 1,
      }),
    ]);
    await assertVisualEquivalence(sourcePage, candidatePage);
  }
}

async function encodeRenderedPage({
  colorMode,
  imageQuality,
  monochromeThreshold,
  pngBytes,
}: Pick<
  PdfCompressionOptions,
  "colorMode" | "imageQuality" | "monochromeThreshold"
> & {
  pngBytes: Buffer;
}) {
  const image = sharp(pngBytes, { failOn: "error" });

  if (colorMode === "MONOCHROME") {
    return {
      bytes: await image
        .grayscale()
        .threshold(monochromeThreshold)
        .png({
          colours: 2,
          compressionLevel: 9,
          effort: 10,
          palette: true,
        })
        .toBuffer(),
      format: "PNG" as const,
    };
  }

  const pipeline = colorMode === "GRAYSCALE" ? image.grayscale() : image;
  return {
    bytes: await pipeline
      .jpeg({
        chromaSubsampling: colorMode === "GRAYSCALE" ? "4:4:4" : "4:2:0",
        force: true,
        mozjpeg: true,
        optimiseCoding: true,
        quality: imageQuality,
      })
      .toBuffer(),
    format: "JPEG" as const,
  };
}

export async function rasterizePdfForCompression({
  inputPath,
  options,
  outputPath,
  onProgress,
}: {
  inputPath: string;
  options: PdfCompressionOptions;
  outputPath: string;
  onProgress?: (progress: number) => Promise<void> | void;
}) {
  ensureServerLocalStorage();
  const source = await PDFDocument.load(await readFile(inputPath), {
    updateMetadata: false,
  });
  const output = await PDFDocument.create();

  try {
    if (source.getPageCount() > 1_000) {
      throw new PdfToolError(
        "PDF_PAGE_LIMIT_EXCEEDED",
        "O PDF ultrapassa o limite de 1.000 páginas para recompressão visual.",
      );
    }

    for (let pageIndex = 1; pageIndex <= source.getPageCount(); pageIndex += 1) {
      const sourcePage = source.getPage(pageIndex - 1);
      const geometry = readPageGeometry(sourcePage);
      const rotated = geometry.rotation === 90 || geometry.rotation === 270;
      const canvasWidth = Math.max(
        1,
        Math.ceil(
          (rotated ? geometry.mediaBox.height : geometry.mediaBox.width) *
            (options.dpi / 72),
        ),
      );
      const canvasHeight = Math.max(
        1,
        Math.ceil(
          (rotated ? geometry.mediaBox.width : geometry.mediaBox.height) *
            (options.dpi / 72),
        ),
      );
      if (canvasWidth * canvasHeight > 25_000_000) {
        throw new PdfToolError(
          "PDF_PAGE_RENDER_LIMIT_EXCEEDED",
          "Uma página ficou grande demais para o DPI escolhido. Reduza a resolução.",
        );
      }
      const renderedPage = await renderPdfPageToPng({
        dpi: options.dpi,
        inputPath,
        pageNumber: pageIndex,
      });
      const unrotatedPage = geometry.rotation
        ? await sharp(renderedPage, { failOn: "error" })
            .rotate((360 - geometry.rotation) % 360)
            .png()
            .toBuffer()
        : renderedPage;

      const encoded = await encodeRenderedPage({
        colorMode: options.colorMode,
        imageQuality: options.imageQuality,
        monochromeThreshold: options.monochromeThreshold,
        pngBytes: unrotatedPage,
      });
      const encodedVisual = geometry.rotation
        ? await sharp(encoded.bytes, { failOn: "error" })
            .rotate(geometry.rotation)
            .png()
            .toBuffer()
        : encoded.bytes;
      await assertVisualCompleteness({
        candidateBytes: encodedVisual,
        colorMode: options.colorMode,
        monochromeThreshold: options.monochromeThreshold,
        sourceBytes: renderedPage,
      });
      const image =
        encoded.format === "PNG"
          ? await output.embedPng(encoded.bytes)
          : await output.embedJpg(encoded.bytes);
      const outputPage = output.addPage([
        geometry.mediaBox.width,
        geometry.mediaBox.height,
      ]);
      applyPageGeometry(outputPage, geometry);
      outputPage.drawImage(image, {
        height: geometry.cropBox.height,
        width: geometry.cropBox.width,
        x: geometry.cropBox.x,
        y: geometry.cropBox.y,
      });

      await onProgress?.((pageIndex / source.getPageCount()) * 100);
    }

    await writeFile(
      outputPath,
      await output.save({
        addDefaultPage: false,
        objectsPerTick: 25,
        useObjectStreams: true,
      }),
    );
  } catch (error) {
    throw error instanceof PdfToolError
      ? error
      : new PdfToolError(
          "PDF_RASTER_COMPRESSION_FAILED",
          "Não foi possível recomprimir as páginas do PDF.",
          error instanceof Error ? error.message : String(error),
        );
  }
}

