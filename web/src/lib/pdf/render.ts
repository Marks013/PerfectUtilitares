import { createCanvas } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import sharp from "sharp";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import type { PdfManifest } from "@/lib/pdf/schema";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";
import { buildStructuralPdf } from "@/lib/pdf/structural";

const MAX_JPEG_PIXELS = 40_000_000;
const MAX_JPEG_DIMENSION = 8_192;

function assertJpegDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0 ||
    width > MAX_JPEG_DIMENSION || height > MAX_JPEG_DIMENSION ||
    width * height > MAX_JPEG_PIXELS
  ) {
    throw new PdfRenderError(
      "PDF_IMAGE_TOO_LARGE",
      "A página excede o limite de 40 megapixels ou 8192 pixels por lado. Reduza a resolução (DPI) ou recorte a página antes de converter.",
    );
  }
}

type RenderInput = {
  id: string;
  originalName: string;
  storageKey: string;
};

export class PdfRenderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    details?: string,
  ) {
    super(message, {
      cause: details ? new Error(details.slice(0, 4_000)) : undefined,
    });
    this.name = "PdfRenderError";
  }
}

function runPoppler(args: string[], timeoutMs = 10 * 60 * 1_000) {
  return new Promise<void>((resolve, reject) => {
    const executable = process.env.PDF_POPPLER_PATH?.trim() || "pdftoppm";
    const childProcess = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorOutput = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      childProcess.kill("SIGKILL");
      finish(() =>
        reject(
          new PdfRenderError(
            "PDF_RENDER_TIMEOUT",
            "A renderização do PDF excedeu o tempo limite.",
          ),
        ),
      );
    }, timeoutMs);

    childProcess.stderr.setEncoding("utf8");
    childProcess.stderr.on("data", (chunk: string) => {
      if (errorOutput.length < 4_000) errorOutput += chunk;
    });
    childProcess.once("error", (error) => {
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfRenderError(
                "PDF_RENDERER_UNAVAILABLE",
                "O renderizador seguro de PDF não está instalado no servidor.",
              )
            : error,
        ),
      );
    });
    childProcess.once("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new PdfRenderError(
            "PDF_RENDER_FAILED",
            "Não foi possível renderizar uma página do PDF.",
            errorOutput.trim(),
          ),
        );
      });
    });
  });
}

async function renderPdfPageWithPdfJs({
  dpi,
  inputPath,
  pageNumber,
  enforceJpegLimits,
}: RenderPdfPageOptions) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument(
    pdfJsServerDocumentOptions(
      new Uint8Array(await readFile(inputPath)),
    ),
  );
  const document = await loadingTask.promise;

  try {
    const page = await document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: dpi / 72 });
      if (enforceJpegLimits) {
        assertJpegDimensions(Math.ceil(viewport.width), Math.ceil(viewport.height));
      }
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const context = canvas.getContext("2d");
      await page.render({
        background: "#FFFFFF",
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      return canvas.toBuffer("image/png");
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

type RenderPdfPageOptions = {
  dpi: number;
  inputPath: string;
  pageNumber: number;
  cropBox?: boolean;
  enforceJpegLimits?: boolean;
};

export async function renderPdfPageToPng(options: RenderPdfPageOptions) {
  if (process.env.PDF_RENDERER === "pdfjs") {
    return renderPdfPageWithPdfJs(options);
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "perfect-pdf-render-"),
  );
  const outputPrefix = path.join(temporaryDirectory, "page");

  try {
    await runPoppler([
      ...(options.cropBox ? ["-cropbox"] : []),
      "-f",
      String(options.pageNumber),
      "-l",
      String(options.pageNumber),
      "-singlefile",
      "-png",
      "-r",
      String(options.dpi),
      options.inputPath,
      outputPrefix,
    ]);
    const bytes = await readFile(`${outputPrefix}.png`);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new PdfRenderError(
        "PDF_RENDER_EMPTY",
        "O renderizador produziu uma página vazia.",
      );
    }
    return bytes;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}



export async function renderPdfPagesToPng({
  dpi,
  inputPath,
  pageNumbers,
}: {
  dpi: number;
  inputPath: string;
  pageNumbers: number[];
}) {
  const uniquePages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const result = new Map<number, Buffer>();
  if (!uniquePages.length) return result;
  if (process.env.PDF_RENDERER === "pdfjs") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument(
      pdfJsServerDocumentOptions(new Uint8Array(await readFile(inputPath))),
    ).promise;
    try {
      for (const pageNumber of uniquePages) {
        const page = await document.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: dpi / 72 });
          const canvas = createCanvas(
            Math.max(1, Math.ceil(viewport.width)),
            Math.max(1, Math.ceil(viewport.height)),
          );
          const context = canvas.getContext("2d");
          await page.render({
            background: "#FFFFFF",
            canvas: canvas as unknown as HTMLCanvasElement,
            canvasContext: context as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          result.set(pageNumber, canvas.toBuffer("image/png"));
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await document.cleanup();
    }
    return result;
  }
  const first = uniquePages[0];
  const last = uniquePages[uniquePages.length - 1];
  if (first === undefined || last === undefined) return result;
  const contiguous = last - first + 1 === uniquePages.length;
  if (!contiguous) {
    for (const pageNumber of uniquePages) {
      result.set(pageNumber, await renderPdfPageToPng({ dpi, inputPath, pageNumber }));
    }
    return result;
  }
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-render-batch-"));
  const outputPrefix = path.join(temporaryDirectory, "page");
  try {
    await runPoppler([
      "-f",
      String(first),
      "-l",
      String(last),
      "-png",
      "-r",
      String(dpi),
      inputPath,
      outputPrefix,
    ]);
    const files = await readdir(temporaryDirectory);
    for (const fileName of files) {
      const match = fileName.match(/-(\d+)\.png$/i);
      if (!match) continue;
      const pageNumber = Number(match[1]);
      if (!uniquePages.includes(pageNumber)) continue;
      const bytes = await readFile(path.join(temporaryDirectory, fileName));
      const metadata = await sharp(bytes, { failOn: "error" }).metadata();
      if (!metadata.width || !metadata.height) {
        throw new PdfRenderError(
          "PDF_RENDER_EMPTY",
          "O renderizador produziu uma página vazia.",
        );
      }
      result.set(pageNumber, bytes);
    }
    if (result.size !== uniquePages.length) {
      throw new PdfRenderError(
        "PDF_RENDER_MISSING_PAGE",
        "O renderizador não devolveu todas as páginas solicitadas.",
      );
    }
    return result;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function renderPdfPagesToJpeg({
  inputs,
  manifest,
  onOutput,
  onProgress,
  quality = 90,
  dpi = 200,
}: {
  inputs: Map<string, RenderInput>;
  manifest: PdfManifest;
  quality?: number;
  dpi?: number;
  onOutput: (
    instruction: PdfManifest["pages"][number],
    bytes: Uint8Array,
    index: number,
  ) => Promise<void> | void;
  onProgress?: (progress: number) => Promise<void> | void;
}) {
  ensureServerLocalStorage();
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 300 ||
      !Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new PdfRenderError("INVALID_IMAGE_OPTIONS", "Selecione uma resolução entre 72 e 300 DPI e uma qualidade entre 1 e 100.");
  }
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-jpeg-"));
  const inputPath = path.join(temporaryDirectory, "page.pdf");
  try {
    // Reuse the editor's crop/rotation contract, reading each source only once.
    const preparedBytes = await buildStructuralPdf({ inputs, manifest });
    const preparedDocument = await PDFDocument.load(preparedBytes);
    for (const page of preparedDocument.getPages()) {
      const box = page.getCropBox();
      const userUnit = page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() ?? 1;
      assertJpegDimensions(
        Math.ceil(box.width * dpi / 72 * userUnit),
        Math.ceil(box.height * dpi / 72 * userUnit),
      );
    }
    await writeFile(inputPath, preparedBytes);
    // Only one raster page is held at a time, even for long documents.
    for (const [index, instruction] of manifest.pages.entries()) {
      const pngBytes = await renderPdfPageToPng({
        dpi,
        inputPath,
        pageNumber: index + 1,
        cropBox: true,
        enforceJpegLimits: true,
      });
      const bytes = await sharp(pngBytes, { failOn: "error", limitInputPixels: MAX_JPEG_PIXELS })
        .flatten({ background: "#FFFFFF" })
        .withMetadata({ density: dpi })
        .jpeg({
          chromaSubsampling: "4:4:4",
          force: true,
          mozjpeg: true,
          optimiseCoding: true,
          quality,
        })
        .toBuffer();
      await onOutput(instruction, bytes, index);
      await onProgress?.(10 + ((index + 1) / manifest.pages.length) * 80);
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
