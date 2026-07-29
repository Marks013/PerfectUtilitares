import { spawn } from "node:child_process";
import { copyFile, stat } from "node:fs/promises";
import {
  commitPdfOutput,
  discardPdfOutput,
  reservePdfOutput,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";

export type PdfCompressionQuality = "SCREEN" | "BALANCED" | "PRINT";

const QUALITY_PRESET: Record<PdfCompressionQuality, string> = {
  SCREEN: "aggressive",
  BALANCED: "balanced",
  PRINT: "lossless",
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
    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      reject(
        new PdfToolError(
          "PDF_TOOL_TIMEOUT",
          "A compressão ultrapassou o tempo máximo permitido.",
        ),
      );
    }, timeoutMs);

    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      if (errorOutput.length < 4_000) errorOutput += chunk;
    });
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        error && "code" in error && error.code === "ENOENT"
          ? new PdfToolError(
          "PDF_TOOL_UNAVAILABLE",
            "O serviço de compressão não está instalado no servidor.",
          )
          : error,
      );
    });
    process.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new PdfToolError(
          "PDF_COMPRESSION_FAILED",
          "Não foi possível comprimir o PDF.",
          errorOutput.trim(),
        ),
      );
    });
  });
}

export async function compressPdfFile({
  inputStorageKey,
  jobId,
  outputName,
  quality,
}: {
  inputStorageKey: string;
  jobId: string;
  outputName: string;
  quality: PdfCompressionQuality;
}) {
  const reservation = await reservePdfOutput(jobId, outputName);

  try {
    const inputPath = resolvePdfStorageKey(inputStorageKey);
    const imageOptions =
      QUALITY_PRESET[quality] === "aggressive"
        ? [
            "--optimize-images",
            "--oi-min-width=0",
            "--oi-min-height=0",
            "--oi-min-area=0",
          ]
        : QUALITY_PRESET[quality] === "balanced"
          ? ["--optimize-images"]
          : [];
    await runQpdf([
      "--warning-exit-0",
      "--object-streams=generate",
      "--compress-streams=y",
      "--decode-level=generalized",
      "--recompress-flate",
      "--compression-level=9",
      ...imageOptions,
      "--",
      inputPath,
      reservation.temporaryPath,
    ]);

    const [inputStats, outputStats] = await Promise.all([
      stat(inputPath),
      stat(reservation.temporaryPath),
    ]);
    if (outputStats.size >= inputStats.size) {
      await copyFile(inputPath, reservation.temporaryPath);
    }

    return await commitPdfOutput(reservation);
  } catch (error) {
    await discardPdfOutput(reservation).catch(() => undefined);
    throw error;
  }
}
