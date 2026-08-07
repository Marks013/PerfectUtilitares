import { spawn } from "node:child_process";
import { copyFile, rm, stat } from "node:fs/promises";
import {
  commitPdfOutput,
  discardPdfOutput,
  reservePdfOutput,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";
import {
  PdfToolError,
  type PdfCompressionOptions,
} from "./compression-types";
import {
  rasterizePdfForCompression,
  validateStructuralCandidate,
} from "./compression-visual";

export { PdfToolError } from "./compression-types";
export type { PdfCompressionOptions } from "./compression-types";
export { rasterizePdfForCompression } from "./compression-visual";

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
    "--object-streams=generate",
    "--compress-streams=y",
    "--decode-level=generalized",
    "--recompress-flate",
    "--compression-level=9",
    "--",
    inputPath,
    outputPath,
  ]);
}

async function copySmallestCandidate(
  candidates: string[],
  destinationPath: string,
  inputPath: string,
) {
  if (!candidates.length) {
    throw new PdfToolError(
      "PDF_COMPRESSION_NO_VALID_CANDIDATE",
      "Nenhuma estratégia produziu uma compactação íntegra.",
    );
  }
  const available = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      size: (await stat(candidate)).size,
    })),
  );
  available.sort((left, right) => left.size - right.size);
  const smallest = available[0];

  if (!smallest) {
    throw new PdfToolError(
      "PDF_COMPRESSION_NO_VALID_CANDIDATE",
      "Nenhuma estratégia produziu uma compactação íntegra.",
    );
  }

  const inputSize = (await stat(inputPath)).size;
  if (smallest.size >= inputSize) {
    throw new PdfToolError(
      "PDF_COMPRESSION_NOT_EFFECTIVE",
      "O arquivo já está otimizado; nenhuma compactação íntegra ficou menor que o original.",
    );
  }
  await copyFile(smallest.candidate, destinationPath);
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
  const temporaryCandidates = [structuralPath, rasterPath, optimizedRasterPath];

  try {
    const validCandidates: string[] = [];
    if (options.method === "LOSSLESS" || options.method === "AUTO") {
      try {
        await optimizePdfStructure(inputPath, structuralPath);
        await validateStructuralCandidate(inputPath, structuralPath);
        validCandidates.push(structuralPath);
      } catch {
        // AUTO ainda pode usar candidato visual; LOSSLESS falhará sem candidato.
      }
      await onProgress?.(options.method === "AUTO" ? 10 : 90);
    }

    if (options.method === "RASTER" || options.method === "AUTO") {
      try {
        await rasterizePdfForCompression({
          inputPath,
          options,
          outputPath: rasterPath,
          onProgress: (progress) =>
            onProgress?.(
              options.method === "AUTO" ? 10 + progress * 0.8 : progress * 0.9,
            ),
        });
        validCandidates.push(rasterPath);
        try {
          await optimizePdfStructure(rasterPath, optimizedRasterPath);
          await validateStructuralCandidate(rasterPath, optimizedRasterPath);
          validCandidates.push(optimizedRasterPath);
        } catch {
          // Raster válido continua sendo candidato quando qpdf não otimiza.
        }
      } catch (error) {
        if (options.method === "RASTER") throw error;
      }
      await onProgress?.(95);
    }

    if (options.method === "LOSSLESS") {
      await copySmallestCandidate(
        validCandidates,
        reservation.temporaryPath,
        inputPath,
      );
    } else if (options.method === "RASTER") {
      await copySmallestCandidate(
        validCandidates,
        reservation.temporaryPath,
        inputPath,
      );
    } else {
      await copySmallestCandidate(
        validCandidates,
        reservation.temporaryPath,
        inputPath,
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
