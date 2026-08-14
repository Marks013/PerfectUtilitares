import { spawn } from "node:child_process";
import { copyFile, rm, stat } from "node:fs/promises";
import {
  commitPdfOutput,
  discardPdfOutput,
  reservePdfOutput,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";
import { analyzePdfCompressionProfile } from "./compression-analyzer";
import { withRasterCompressionSlot } from "./compression-concurrency";
import { planPdfCompression } from "./compression-planner";
import { PdfToolError, type PdfCompressionOptions } from "./compression-types";
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
        if (code === 0) return resolve();
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

function minimumSavingsRatio() {
  const configured = Number(process.env.PDF_COMPRESSION_MIN_SAVINGS_RATIO ?? 0.005);
  return Number.isFinite(configured) && configured >= 0 && configured <= 0.25
    ? configured
    : 0.005;
}

async function selectCandidateOrOriginal({
  candidatePath,
  destinationPath,
  inputPath,
}: {
  candidatePath: string;
  destinationPath: string;
  inputPath: string;
}) {
  const [candidate, input] = await Promise.all([stat(candidatePath), stat(inputPath)]);
  const threshold = Math.floor(input.size * (1 - minimumSavingsRatio()));
  if (candidate.size >= threshold) {
    await copyFile(inputPath, destinationPath);
    return "UNCHANGED" as const;
  }
  await copyFile(candidatePath, destinationPath);
  return "COMPRESSED" as const;
}

async function smallestPath(paths: string[]) {
  const candidates = await Promise.all(
    paths.map(async (candidatePath) => ({
      candidatePath,
      size: (await stat(candidatePath)).size,
    })),
  );
  candidates.sort((a, b) => a.size - b.size);
  const first = candidates[0];
  if (!first) {
    throw new PdfToolError(
      "PDF_COMPRESSION_NO_VALID_CANDIDATE",
      "Nenhuma estratégia produziu uma compactação íntegra.",
    );
  }
  return first.candidatePath;
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
    await onProgress?.(2);
    const profile =
      options.method === "AUTO"
        ? await analyzePdfCompressionProfile(inputPath)
        : null;
    const plan = planPdfCompression(options, profile);
    await onProgress?.(10);
    let outcome: "COMPRESSED" | "UNCHANGED";
    if (plan.strategy === "SKIP") {
      await copyFile(inputPath, reservation.temporaryPath);
      outcome = "UNCHANGED";
      await onProgress?.(95);
    } else if (plan.strategy === "STRUCTURAL") {
      try {
        await optimizePdfStructure(inputPath, structuralPath);
        await onProgress?.(options.method === "LOSSLESS" ? 75 : 55);
        await validateStructuralCandidate(inputPath, structuralPath);
        outcome = await selectCandidateOrOriginal({
          candidatePath: structuralPath,
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
      } catch (error) {
        if (options.method === "LOSSLESS") {
          throw new PdfToolError(
            "PDF_COMPRESSION_NO_VALID_CANDIDATE",
            "Nenhuma estratégia produziu uma compactação íntegra.",
            error instanceof Error ? error.message : String(error),
          );
        }
        await copyFile(inputPath, reservation.temporaryPath);
        outcome = "UNCHANGED";
      }
      await onProgress?.(options.method === "LOSSLESS" ? 90 : 95);
    } else {
      outcome = await withRasterCompressionSlot(async () => {
        await rasterizePdfForCompression({
          inputPath,
          options: plan.rasterOptions,
          outputPath: rasterPath,
          onProgress: (progress) => onProgress?.(10 + progress * 0.75),
        });
        const valid = [rasterPath];
        try {
          await optimizePdfStructure(rasterPath, optimizedRasterPath);
          await validateStructuralCandidate(rasterPath, optimizedRasterPath);
          valid.push(optimizedRasterPath);
        } catch {
          // O raster íntegro continua sendo válido mesmo quando qpdf não reduz mais.
        }
        return selectCandidateOrOriginal({
          candidatePath: await smallestPath(valid),
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
      });
      await onProgress?.(95);
    }
    await onProgress?.(100);
    return {
      ...(await commitPdfOutput(reservation)),
      outcome,
      strategy: plan.strategy,
      analysis: profile,
      planReason: plan.reason,
    };
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
