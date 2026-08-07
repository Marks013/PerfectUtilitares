import {
  configurePdfJsClient,
  pdfJsClientDocumentOptions,
} from "@/lib/pdf/pdfjs-client";

export type CompressionMethod = "AUTO" | "LOSSLESS" | "RASTER";
export type CompressionColorMode = "COLOR" | "GRAYSCALE" | "MONOCHROME";
type CompressionContentKind = "VECTOR" | "MIXED" | "SCANNED";

export type PdfCompressionAnalysis = {
  fileKey: string;
  fileName: string;
  pageCount: number;
  sampledPages: number;
  contentKind: CompressionContentKind;
  colorMode: CompressionColorMode;
  sourceDpi: number | null;
  minimumDpi: number | null;
  maximumDpi: number | null;
  imageCount: number;
  hasSelectableText: boolean;
};

export type CompressionRecommendation = {
  method: CompressionMethod;
  dpi: number;
  colorMode: CompressionColorMode;
  imageQuality: number;
  monochromeThreshold: number;
};

type Matrix = [number, number, number, number, number, number];
type ImageDimensions = { width: number; height: number };

const DPI_OPTIONS = [72, 96, 120, 150, 200, 220, 300] as const;
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function asMatrix(value: unknown): Matrix | null {
  if (
    !Array.isArray(value) ||
    value.length < 6 ||
    value.slice(0, 6).some((item) => typeof item !== "number")
  ) {
    return null;
  }
  return value.slice(0, 6) as Matrix;
}

function asImageDimensions(value: unknown): ImageDimensions | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { width?: unknown; height?: unknown };
  return typeof candidate.width === "number" &&
    candidate.width > 0 &&
    typeof candidate.height === "number" &&
    candidate.height > 0
    ? { width: candidate.width, height: candidate.height }
    : null;
}

function readNumber(
  values: ArrayLike<number>,
  index: number,
  context: string,
) {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`Valor numérico ausente durante ${context}.`);
  }

  return value;
}

function median(values: number[]) {
  if (!values.length) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = readNumber(sorted, middle, "o cálculo da mediana");

  if (sorted.length % 2 !== 0) {
    return middleValue;
  }

  const lowerValue = readNumber(
    sorted,
    middle - 1,
    "o cálculo da mediana",
  );

  return (lowerValue + middleValue) / 2;
}

function selectSamplePages(pageCount: number) {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  return [
    1,
    Math.ceil(pageCount / 3),
    Math.ceil((pageCount * 2) / 3),
    pageCount,
  ].filter((page, index, pages) => pages.indexOf(page) === index);
}

function nearestDpi(value: number) {
  return DPI_OPTIONS.reduce((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest,
  );
}

export function classifyRenderedColors(
  pixels: Uint8ClampedArray,
): CompressionColorMode {
  let contentPixels = 0;
  let coloredPixels = 0;
  let intermediateGrayPixels = 0;
  const pixelCount = Math.floor(pixels.length / 4);
  const step = Math.max(1, Math.floor(Math.sqrt(pixelCount / 20_000)));

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    const red = readNumber(pixels, offset, "a análise de cor");
    const green = readNumber(pixels, offset + 1, "a análise de cor");
    const blue = readNumber(pixels, offset + 2, "a análise de cor");
    const alpha = readNumber(pixels, offset + 3, "a análise de cor");
    if (alpha < 32) continue;

    const lightness = (red + green + blue) / 3;
    if (lightness > 248) continue;
    contentPixels += 1;

    const channelDelta =
      Math.max(red, green, blue) - Math.min(red, green, blue);
    if (channelDelta >= 10) {
      coloredPixels += 1;
    } else if (lightness > 28 && lightness < 228) {
      intermediateGrayPixels += 1;
    }
  }

  if (!contentPixels) return "MONOCHROME";
  if (coloredPixels >= 40 && coloredPixels / contentPixels >= 0.003) {
    return "COLOR";
  }
  if (intermediateGrayPixels / contentPixels >= 0.02) {
    return "GRAYSCALE";
  }
  return "MONOCHROME";
}

export function deriveCompressionRecommendation(
  analyses: PdfCompressionAnalysis[],
): CompressionRecommendation {
  const detectedDpis = analyses
    .map((analysis) => analysis.sourceDpi)
    .filter((dpi): dpi is number => dpi !== null);
  const sourceDpi = median(detectedDpis);
  const allVector =
    analyses.length > 0 &&
    analyses.every((analysis) => analysis.contentKind === "VECTOR");
  const hasScanned = analyses.some(
    (analysis) => analysis.contentKind === "SCANNED",
  );
  const colorMode = analyses.some((analysis) => analysis.colorMode === "COLOR")
    ? "COLOR"
    : analyses.some((analysis) => analysis.colorMode === "GRAYSCALE")
      ? "GRAYSCALE"
      : "MONOCHROME";
  const fallbackDpi = hasScanned ? 200 : 150;
  const dpi = nearestDpi(Math.max(72, Math.min(300, sourceDpi ?? fallbackDpi)));

  return {
    method: allVector ? "LOSSLESS" : "AUTO",
    dpi,
    colorMode,
    imageQuality:
      colorMode === "COLOR" ? (dpi >= 220 ? 86 : dpi >= 150 ? 80 : 74) : 84,
    monochromeThreshold: 160,
  };
}

export async function analyzePdfForCompression(
  file: File,
  fileKey: string,
): Promise<PdfCompressionAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfJsClient(pdfjs);
  const loadingTask = pdfjs.getDocument({
    ...pdfJsClientDocumentOptions(
      new Uint8Array(await file.arrayBuffer()),
    ),
    stopAtErrors: false,
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const sampledPageNumbers = selectSamplePages(pageCount);
  const effectiveDpis: number[] = [];
  const colorModes: CompressionColorMode[] = [];
  let imageCount = 0;
  let textCharacters = 0;

  try {
    for (const pageNumber of sampledPageNumbers) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const renderScale = Math.min(
        1,
        640 / Math.max(viewport.width, viewport.height),
      );
      const renderViewport = page.getViewport({ scale: renderScale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(renderViewport.width));
      canvas.height = Math.max(1, Math.ceil(renderViewport.height));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("O navegador não permitiu analisar as páginas.");
      }

      const textContentPromise = page.getTextContent();
      const operatorListPromise = page.getOperatorList();
      await page.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
        background: "#FFFFFF",
      }).promise;
      const [textContent, operatorList] = await Promise.all([
        textContentPromise,
        operatorListPromise,
      ]);

      textCharacters += textContent.items.reduce(
        (total, item) =>
          total +
          ("str" in item && typeof item.str === "string"
            ? item.str.trim().length
            : 0),
        0,
      );
      colorModes.push(
        classifyRenderedColors(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      );

      let currentMatrix = IDENTITY_MATRIX;
      const matrixStack: Matrix[] = [];

      for (
        let operationIndex = 0;
        operationIndex < operatorList.fnArray.length;
        operationIndex += 1
      ) {
        const operation = operatorList.fnArray[operationIndex];
        const args = operatorList.argsArray[operationIndex] as unknown[];

        if (operation === pdfjs.OPS.save) {
          matrixStack.push([...currentMatrix] as Matrix);
          continue;
        }
        if (operation === pdfjs.OPS.restore) {
          currentMatrix = matrixStack.pop() ?? IDENTITY_MATRIX;
          continue;
        }
        if (operation === pdfjs.OPS.transform) {
          const transform = asMatrix(args);
          if (transform) {
            currentMatrix = multiplyMatrices(currentMatrix, transform);
          }
          continue;
        }

        let dimensions: ImageDimensions | null = null;
        if (operation === pdfjs.OPS.paintImageXObject) {
          const objectId = args[0];
          const width = args[1];
          const height = args[2];
          if (
            typeof width === "number" &&
            width > 0 &&
            typeof height === "number" &&
            height > 0
          ) {
            dimensions = { width, height };
          } else if (typeof objectId === "string") {
            try {
              dimensions = asImageDimensions(page.objs.get(objectId));
            } catch {
              dimensions = null;
            }
          }
        } else if (operation === pdfjs.OPS.paintInlineImageXObject) {
          dimensions = asImageDimensions(args[0]);
        }

        if (!dimensions) continue;
        imageCount += 1;
        const widthPoints = Math.hypot(currentMatrix[0], currentMatrix[1]);
        const heightPoints = Math.hypot(currentMatrix[2], currentMatrix[3]);
        if (widthPoints < 1 || heightPoints < 1) continue;
        const dpiX = (dimensions.width * 72) / widthPoints;
        const dpiY = (dimensions.height * 72) / heightPoints;
        const effectiveDpi = Math.min(dpiX, dpiY);
        if (effectiveDpi >= 36 && effectiveDpi <= 2_400) {
          effectiveDpis.push(effectiveDpi);
        }
      }

      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  const hasSelectableText = textCharacters >= sampledPageNumbers.length * 12;
  const contentKind: CompressionContentKind =
    imageCount === 0 ? "VECTOR" : hasSelectableText ? "MIXED" : "SCANNED";
  const sourceDpi = median(effectiveDpis);
  const roundedDpis = effectiveDpis.map((dpi) => Math.round(dpi));
  const colorMode = colorModes.includes("COLOR")
    ? "COLOR"
    : colorModes.includes("GRAYSCALE")
      ? "GRAYSCALE"
      : "MONOCHROME";

  return {
    fileKey,
    fileName: file.name,
    pageCount,
    sampledPages: sampledPageNumbers.length,
    contentKind,
    colorMode,
    sourceDpi: sourceDpi === null ? null : Math.round(sourceDpi),
    minimumDpi: roundedDpis.length ? Math.min(...roundedDpis) : null,
    maximumDpi: roundedDpis.length ? Math.max(...roundedDpis) : null,
    imageCount,
    hasSelectableText,
  };
}
