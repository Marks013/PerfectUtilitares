import { createCanvas } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import type { PdfManifest } from "@/lib/pdf/schema";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";
import { resolvePdfStorageKey } from "@/lib/pdf/storage";
import { PdfStructureError } from "@/lib/pdf/structural";

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
}: RenderPdfPageOptions) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument(
    pdfJsServerDocumentOptions(
      new Uint8Array(await readFile(inputPath)),
    ),
  ).promise;

  try {
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
      return canvas.toBuffer("image/png");
    } finally {
      page.cleanup();
    }
  } finally {
    await document.cleanup();
  }
}

type RenderPdfPageOptions = {
  dpi: number;
  inputPath: string;
  pageNumber: number;
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

export async function renderPdfPagesToJpeg({
  inputs,
  manifest,
  onOutput,
  onProgress,
  quality = 82,
  dpi = 150,
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
  const pageCounts = new Map<string, number>();

  for (const [index, instruction] of manifest.pages.entries()) {
      const input = inputs.get(instruction.artifactId);
      if (!input) {
        throw new PdfStructureError(
          "INVALID_PAGE_SOURCE",
          "Uma página referencia um arquivo que não pertence ao trabalho.",
        );
      }

      let pageCount = pageCounts.get(input.id);
      if (!pageCount) {
        try {
          const document = await PDFDocument.load(
            await readFile(resolvePdfStorageKey(input.storageKey)),
            { updateMetadata: false },
          );
          pageCount = document.getPageCount();
          pageCounts.set(input.id, pageCount);
        } catch {
          throw new PdfStructureError(
            "PDF_OPEN_FAILED",
            `Não foi possível abrir ${input.originalName}.`,
          );
        }
      }

      if (instruction.sourcePage > pageCount) {
        throw new PdfStructureError(
          "PAGE_NOT_FOUND",
          `A página ${instruction.sourcePage} não existe em ${input.originalName}.`,
        );
      }

      const pngBytes = await renderPdfPageToPng({
        dpi,
        inputPath: resolvePdfStorageKey(input.storageKey),
        pageNumber: instruction.sourcePage,
      });
      const bytes = await sharp(pngBytes, { failOn: "error" })
        .rotate(instruction.rotation)
        .flatten({ background: "#FFFFFF" })
        .jpeg({
          chromaSubsampling: "4:2:0",
          force: true,
          mozjpeg: true,
          optimiseCoding: true,
          quality,
        })
        .toBuffer();
      await onOutput(instruction, bytes, index);
      await onProgress?.(10 + ((index + 1) / manifest.pages.length) * 80);
  }
}
