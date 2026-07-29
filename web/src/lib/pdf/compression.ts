import { createCanvas } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import {
  copyFile,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";
import {
  commitPdfOutput,
  discardPdfOutput,
  reservePdfOutput,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";

export type PdfCompressionQuality = "SCREEN" | "BALANCED" | "PRINT";
export type PdfCompressionMethod = "AUTO" | "LOSSLESS" | "RASTER";
export type PdfCompressionColorMode =
  | "COLOR"
  | "GRAYSCALE"
  | "MONOCHROME";

export type PdfCompressionOptions = {
  quality: PdfCompressionQuality;
  method: PdfCompressionMethod;
  dpi: number;
  colorMode: PdfCompressionColorMode;
  imageQuality: number;
  monochromeThreshold: number;
};

export class PdfToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    details?: string,
  ) {
    super(message, {
      cause: details ? new Error(details.slice(0, 4_000)) : undefined,
    });
    this.name = "PdfToolError";
  }
}

function runQpdf(args: string[], timeoutMs = 10 * 60 * 1000) {
  return new Promise<void>((resolve, reject) => {
    const process = spawn("qpdf", args, {
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
      process.kill("SIGKILL");
      finish(() =>
        reject(
          new PdfToolError(
            "PDF_TOOL_TIMEOUT",
            "A compactação ultrapassou o tempo máximo permitido.",
          ),
        ),
      );
    }, timeoutMs);

    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      if (errorOutput.length < 4_000) errorOutput += chunk;
    });
    process.once("error", (error) => {
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfToolError(
                "PDF_TOOL_UNAVAILABLE",
                "O serviço de compactação não está instalado no servidor.",
              )
            : error,
        ),
      );
    });
    process.once("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new PdfToolError(
            "PDF_COMPRESSION_FAILED",
            "Não foi possível compactar o PDF.",
            errorOutput.trim(),
          ),
        );
      });
    });
  });
}

async function optimizePdfStructure(inputPath: string, outputPath: string) {
  await runQpdf([
    "--warning-exit-0",
    "--object-streams=generate",
    "--compress-streams=y",
    "--decode-level=generalized",
    "--recompress-flate",
    "--compression-level=9",
    "--optimize-images",
    "--oi-min-width=0",
    "--oi-min-height=0",
    "--oi-min-area=0",
    "--",
    inputPath,
    outputPath,
  ]);
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
        chromaSubsampling:
          colorMode === "GRAYSCALE" ? "4:4:4" : "4:2:0",
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
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const source = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(inputPath)),
    useSystemFonts: true,
  }).promise;
  const output = await PDFDocument.create();

  try {
    if (source.numPages > 1_000) {
      throw new PdfToolError(
        "PDF_PAGE_LIMIT_EXCEEDED",
        "O PDF ultrapassa o limite de 1.000 páginas para recompressão visual.",
      );
    }

    for (let pageIndex = 1; pageIndex <= source.numPages; pageIndex += 1) {
      const sourcePage = await source.getPage(pageIndex);
      const pageViewport = sourcePage.getViewport({ scale: 1 });
      const renderViewport = sourcePage.getViewport({
        scale: options.dpi / 72,
      });
      const canvasWidth = Math.max(1, Math.ceil(renderViewport.width));
      const canvasHeight = Math.max(1, Math.ceil(renderViewport.height));
      if (canvasWidth * canvasHeight > 25_000_000) {
        throw new PdfToolError(
          "PDF_PAGE_RENDER_LIMIT_EXCEEDED",
          "Uma página ficou grande demais para o DPI escolhido. Reduza a resolução.",
        );
      }
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const context = canvas.getContext("2d");

      await sourcePage.render({
        background: "#FFFFFF",
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport: renderViewport,
      }).promise;

      const encoded = await encodeRenderedPage({
        colorMode: options.colorMode,
        imageQuality: options.imageQuality,
        monochromeThreshold: options.monochromeThreshold,
        pngBytes: canvas.toBuffer("image/png"),
      });
      const image =
        encoded.format === "PNG"
          ? await output.embedPng(encoded.bytes)
          : await output.embedJpg(encoded.bytes);
      const outputPage = output.addPage([
        pageViewport.width,
        pageViewport.height,
      ]);
      outputPage.drawImage(image, {
        height: pageViewport.height,
        width: pageViewport.width,
        x: 0,
        y: 0,
      });

      sourcePage.cleanup();
      await onProgress?.((pageIndex / source.numPages) * 100);
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
  } finally {
    await source.cleanup();
  }
}

async function copySmallestCandidate(
  candidates: string[],
  destinationPath: string,
) {
  const available = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      size: (await stat(candidate)).size,
    })),
  );
  available.sort((left, right) => left.size - right.size);
  await copyFile(available[0]!.candidate, destinationPath);
}

export async function compressPdfFile({
  inputStorageKey,
  jobId,
  onProgress,
  options,
  outputName,
}: {
  inputStorageKey: string;
  jobId: string;
  onProgress?: (progress: number) => Promise<void> | void;
  options: PdfCompressionOptions;
  outputName: string;
}) {
  const reservation = await reservePdfOutput(jobId, outputName);
  const inputPath = resolvePdfStorageKey(inputStorageKey);
  const structuralPath = `${reservation.temporaryPath}.structural.pdf`;
  const rasterPath = `${reservation.temporaryPath}.raster.pdf`;
  const optimizedRasterPath = `${reservation.temporaryPath}.raster-optimized.pdf`;
  const temporaryCandidates = [
    structuralPath,
    rasterPath,
    optimizedRasterPath,
  ];

  try {
    if (options.method === "LOSSLESS" || options.method === "AUTO") {
      await optimizePdfStructure(inputPath, structuralPath);
      await onProgress?.(options.method === "AUTO" ? 10 : 90);
    }

    if (options.method === "RASTER" || options.method === "AUTO") {
      await rasterizePdfForCompression({
        inputPath,
        options,
        outputPath: rasterPath,
        onProgress: (progress) =>
          onProgress?.(
            options.method === "AUTO"
              ? 10 + progress * 0.8
              : progress * 0.9,
          ),
      });
      await optimizePdfStructure(rasterPath, optimizedRasterPath);
      await onProgress?.(95);
    }

    if (options.method === "LOSSLESS") {
      await copySmallestCandidate(
        [inputPath, structuralPath],
        reservation.temporaryPath,
      );
    } else if (options.method === "RASTER") {
      await copySmallestCandidate(
        [rasterPath, optimizedRasterPath],
        reservation.temporaryPath,
      );
    } else {
      await copySmallestCandidate(
        [inputPath, structuralPath, rasterPath, optimizedRasterPath],
        reservation.temporaryPath,
      );
    }

    await onProgress?.(100);
    return await commitPdfOutput(reservation);
  } catch (error) {
    await discardPdfOutput(reservation).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all(
      temporaryCandidates.map((candidate) =>
        rm(candidate, { force: true }).catch(() => undefined),
      ),
    );
  }
}
