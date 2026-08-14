import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { PdfToolError, type PdfCompressionColorMode } from "./compression-types";

type PdfCompressionContentKind =
  | "VECTOR"
  | "MIXED"
  | "SCANNED"
  | "SCANNED_OCR";

type PdfImageEncoding =
  | "JBIG2"
  | "CCITT"
  | "JPEG"
  | "JPX"
  | "FLATE"
  | "OTHER"
  | null;

export type PdfCompressionProfile = {
  pageCount: number;
  sampledPages: number[];
  contentKind: PdfCompressionContentKind;
  colorMode: PdfCompressionColorMode;
  sourceDpi: number | null;
  minimumDpi: number | null;
  maximumDpi: number | null;
  fullPageImageRatio: number;
  imageCoverageRatio: number;
  imageCount: number;
  hasSelectableText: boolean;
  hasOcrLayer: boolean;
  predominantImageEncoding: PdfImageEncoding;
  bitsPerComponent: number | null;
  alreadyOptimized: boolean;
};

type PdfImageRow = {
  page: number;
  width: number;
  height: number;
  color: string;
  components: number;
  bitsPerComponent: number;
  encoding: string;
  xPpi: number;
  yPpi: number;
};

function runCommand(executable: string, args: string[], timeoutMs = 30_000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new PdfToolError(
            "PDF_ANALYSIS_TIMEOUT",
            "A análise automática do PDF excedeu o tempo permitido.",
          ),
        ),
      );
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 2_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    child.once("error", (error) => {
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfToolError(
                "PDF_ANALYZER_UNAVAILABLE",
                "O analisador Poppler não está instalado no servidor.",
              )
            : error,
        ),
      );
    });
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) return resolve(stdout);
        reject(
          new PdfToolError(
            "PDF_ANALYSIS_FAILED",
            "Não foi possível analisar a estrutura de imagens do PDF.",
            stderr.trim(),
          ),
        );
      });
    });
  });
}

export function selectCompressionSamplePages(pageCount: number) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  return [
    1,
    Math.max(1, Math.round(pageCount * 0.25)),
    Math.max(1, Math.round(pageCount * 0.5)),
    Math.max(1, Math.round(pageCount * 0.75)),
    pageCount,
  ].filter((page, index, pages) => pages.indexOf(page) === index);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function weightedMode<T extends string | number>(
  values: Array<{ value: T; weight: number }>,
): T | null {
  const weights = new Map<T, number>();
  for (const item of values) {
    weights.set(item.value, (weights.get(item.value) ?? 0) + item.weight);
  }
  let selected: T | null = null;
  let maxWeight = -1;
  for (const [value, weight] of weights) {
    if (weight > maxWeight) {
      selected = value;
      maxWeight = weight;
    }
  }
  return selected;
}

export function parsePdfImagesList(output: string): PdfImageRow[] {
  const rows: PdfImageRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 14) continue;
    const page = Number(columns[0]);
    const width = Number(columns[3]);
    const height = Number(columns[4]);
    const components = Number(columns[6]);
    const bitsPerComponent = Number(columns[7]);
    const xPpi = Number(columns[12]);
    const yPpi = Number(columns[13]);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(xPpi) ||
      !Number.isFinite(yPpi) ||
      width <= 0 ||
      height <= 0 ||
      xPpi <= 0 ||
      yPpi <= 0
    ) {
      continue;
    }
    rows.push({
      page,
      width,
      height,
      color: (columns[5] ?? "").toLowerCase(),
      components: Number.isFinite(components) ? components : 0,
      bitsPerComponent: Number.isFinite(bitsPerComponent) ? bitsPerComponent : 8,
      encoding: (columns[8] ?? "").toLowerCase(),
      xPpi,
      yPpi,
    });
  }
  return rows;
}

function normalizeEncoding(value: string): Exclude<PdfImageEncoding, null> {
  if (value.includes("jbig2")) return "JBIG2";
  if (value.includes("ccitt")) return "CCITT";
  if (value.includes("jpeg") || value.includes("dct")) return "JPEG";
  if (value.includes("jpx")) return "JPX";
  if (value.includes("flate") || value === "image") return "FLATE";
  return "OTHER";
}

async function readSelectableText(inputPath: string, pageNumbers: number[]) {
  const bytes = new Uint8Array(await readFile(inputPath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await loadingTask.promise;
  let characters = 0;
  try {
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      try {
        const text = await page.getTextContent();
        characters += text.items.reduce(
          (total, item) =>
            total +
            ("str" in item && typeof item.str === "string"
              ? item.str.trim().length
              : 0),
          0,
        );
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return characters >= pageNumbers.length * 12;
}

export async function analyzePdfCompressionProfile(
  inputPath: string,
): Promise<PdfCompressionProfile> {
  const sourceBytes = await readFile(inputPath);
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (!pageCount) {
    throw new PdfToolError("PDF_EMPTY", "O PDF não possui páginas para analisar.");
  }
  const sampledPages = selectCompressionSamplePages(pageCount);
  const [imageList, hasSelectableText] = await Promise.all([
    runCommand("pdfimages", ["-list", inputPath]),
    readSelectableText(inputPath, sampledPages),
  ]);
  const rows = parsePdfImagesList(imageList);
  const sampledSet = new Set(sampledPages);
  const sampledRows = rows.filter((row) => sampledSet.has(row.page));
  const dominantRows: Array<PdfImageRow & { coverage: number }> = [];
  let fullPageImages = 0;
  let coverageSum = 0;
  for (const pageNumber of sampledPages) {
    const page = source.getPage(pageNumber - 1);
    const box = page.getMediaBox();
    const pageArea = Math.max(1, box.width * box.height);
    const pageRows = sampledRows.filter((row) => row.page === pageNumber);
    let best: (PdfImageRow & { coverage: number }) | null = null;
    for (const row of pageRows) {
      const widthPoints = (row.width * 72) / row.xPpi;
      const heightPoints = (row.height * 72) / row.yPpi;
      const coverage = Math.max(
        0,
        Math.min(1, (widthPoints * heightPoints) / pageArea),
      );
      if (!best || coverage > best.coverage) best = { ...row, coverage };
    }
    if (best) {
      dominantRows.push(best);
      coverageSum += best.coverage;
      if (best.coverage >= 0.82) fullPageImages += 1;
    }
  }
  const fullPageImageRatio = fullPageImages / sampledPages.length;
  const imageCoverageRatio = coverageSum / sampledPages.length;
  const scanLike = fullPageImageRatio >= 0.8;
  const contentKind: PdfCompressionContentKind =
    rows.length === 0
      ? "VECTOR"
      : scanLike
        ? hasSelectableText
          ? "SCANNED_OCR"
          : "SCANNED"
        : "MIXED";
  const relevantRows = dominantRows.length ? dominantRows : sampledRows;
  const dpis = relevantRows.map((row) => Math.min(row.xPpi, row.yPpi));
  const sourceDpiValue = median(dpis);
  const roundedDpis = dpis.map((dpi) => Math.round(dpi));
  const weightedRows = relevantRows.map((row) => ({
    row,
    weight: Math.max(1, row.width * row.height),
  }));
  const colorMode: PdfCompressionColorMode = weightedRows.some(
    ({ row }) =>
      row.color.includes("rgb") ||
      row.color.includes("cmyk") ||
      row.components >= 3,
  )
    ? "COLOR"
    : weightedRows.some(({ row }) => row.bitsPerComponent > 1)
      ? "GRAYSCALE"
      : "MONOCHROME";
  const predominantImageEncoding = weightedMode(
    weightedRows.map(({ row, weight }) => ({
      value: normalizeEncoding(row.encoding),
      weight,
    })),
  );
  const bitsPerComponent = weightedMode(
    weightedRows.map(({ row, weight }) => ({
      value: row.bitsPerComponent,
      weight,
    })),
  );
  const sourceDpi = sourceDpiValue === null ? null : Math.round(sourceDpiValue);
  const alreadyOptimized =
    (contentKind === "SCANNED" || contentKind === "SCANNED_OCR") &&
    fullPageImageRatio >= 0.8 &&
    colorMode === "MONOCHROME" &&
    bitsPerComponent === 1 &&
    sourceDpi !== null &&
    sourceDpi >= 120 &&
    sourceDpi <= 300 &&
    (predominantImageEncoding === "JBIG2" ||
      predominantImageEncoding === "CCITT");
  return {
    pageCount,
    sampledPages,
    contentKind,
    colorMode,
    sourceDpi,
    minimumDpi: roundedDpis.length ? Math.min(...roundedDpis) : null,
    maximumDpi: roundedDpis.length ? Math.max(...roundedDpis) : null,
    fullPageImageRatio,
    imageCoverageRatio,
    imageCount: rows.length,
    hasSelectableText,
    hasOcrLayer: scanLike && hasSelectableText,
    predominantImageEncoding,
    bitsPerComponent,
    alreadyOptimized,
  };
}
