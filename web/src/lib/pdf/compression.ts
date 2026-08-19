// PERFECT_PDF_FULL32_V2_2
import { copyFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { analyzePdfCompressionProfile } from "./compression-analyzer";
import { withRasterCompressionSlot } from "./compression-concurrency";
import {
  buildPreservingImageCandidates,
  optimizeMonochromeRasterCandidate,
} from "./compression-image-recompression";
import { planPdfCompression } from "./compression-planner";
import { validateSemanticCandidate } from "./compression-semantic";
import {
  PDF_COMPRESSION_PROTOCOL_REVISION,
  PdfToolError,
  type PdfCompressionOptions,
} from "./compression-types";
import {
  rasterizePdfForCompression,
  validateStructuralCandidate,
} from "./compression-visual";
import {
  commitPdfOutput,
  discardPdfOutput,
  reservePdfOutput,
  resolvePdfStorageKey,
} from "./storage";

export { PdfToolError } from "./compression-types";
export type {
  PdfCompressionEffectiveOptions,
  PdfCompressionOptions,
} from "./compression-types";
export {
  rasterizePdfForCompression,
  validateStructuralCandidate,
} from "./compression-visual";

function toolTimeoutMs() {
  const configured = Number(
    process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS ?? 10 * 60 * 1000,
  );
  return Number.isFinite(configured) &&
    configured >= 30_000 &&
    configured <= 30 * 60 * 1000
    ? configured
    : 10 * 60 * 1000;
}

function runQpdf(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("qpdf", args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
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
            "PDF_TOOL_TIMEOUT",
            "A compactação estrutural excedeu o tempo permitido.",
          ),
        ),
      );
    }, toolTimeoutMs());
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    child.once("error", (error) =>
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfToolError(
                "PDF_TOOL_UNAVAILABLE",
                "qpdf não está disponível no worker.",
              )
            : error,
        ),
      ),
    );
    child.once("close", (code) =>
      finish(() =>
        code === 0
          ? resolve()
          : reject(
              new PdfToolError(
                "PDF_COMPRESSION_FAILED",
                "qpdf não conseguiu gerar um candidato válido.",
                stderr,
              ),
            ),
      ),
    );
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
  const configured = Number(
    process.env.PDF_COMPRESSION_MIN_SAVINGS_RATIO ?? 0.005,
  );
  return Number.isFinite(configured) && configured >= 0 && configured <= 0.25
    ? configured
    : 0.005;
}

async function selectCandidateOrOriginal({
  candidates,
  destinationPath,
  inputPath,
}: {
  candidates: string[];
  destinationPath: string;
  inputPath: string;
}) {
  const input = await stat(inputPath);
  const existing: Array<{ path: string; size: number }> = [];
  for (const candidate of candidates) {
    try {
      existing.push({ path: candidate, size: (await stat(candidate)).size });
    } catch {
      // candidato ausente/descartado
    }
  }
  existing.sort((left, right) => left.size - right.size);
  const best = existing[0];
  const threshold = Math.floor(input.size * (1 - minimumSavingsRatio()));
  if (!best || best.size >= threshold) {
    await copyFile(inputPath, destinationPath);
    return "UNCHANGED" as const;
  }
  await copyFile(best.path, destinationPath);
  return "COMPRESSED" as const;
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
  const qpdfRasterPath = `${reservation.temporaryPath}.raster-qpdf.pdf`;
  const monoRasterPath = `${reservation.temporaryPath}.raster-ccitt.pdf`;
  const preservingBase = `${reservation.temporaryPath}.preserving`;
  const temporaryCandidates = [
    structuralPath,
    rasterPath,
    qpdfRasterPath,
    monoRasterPath,
    `${preservingBase}.qpdf-images.pdf`,
    `${preservingBase}.gs-images.pdf`,
  ];

  try {
    const runtimeRevision =
      process.env.SOURCE_REVISION &&
      process.env.SOURCE_REVISION !== "unknown"
        ? process.env.SOURCE_REVISION
        : PDF_COMPRESSION_PROTOCOL_REVISION;
    if (options.sourceRevision && options.sourceRevision !== runtimeRevision) {
      throw new PdfToolError(
        "PDF_WORKER_VERSION_MISMATCH",
        `Job (${options.sourceRevision}) e worker (${runtimeRevision}) estão em revisões diferentes.`,
      );
    }

    await onProgress?.(2);
    const profile =
      options.method === "LOSSLESS"
        ? null
        : await analyzePdfCompressionProfile(inputPath);
    const plan = planPdfCompression(options, profile);
    await onProgress?.(10);

    let outcome: "COMPRESSED" | "UNCHANGED";
    let semanticValidated = false;

    if (plan.strategy === "SKIP") {
      await copyFile(inputPath, reservation.temporaryPath);
      outcome = "UNCHANGED";
    } else if (plan.strategy === "STRUCTURAL") {
      try {
        await optimizePdfStructure(inputPath, structuralPath);
        await validateStructuralCandidate(inputPath, structuralPath);
        await validateSemanticCandidate(inputPath, structuralPath, {
          visual: false,
        });
        semanticValidated = true;
        outcome = await selectCandidateOrOriginal({
          candidates: [structuralPath],
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
      } catch (error) {
        if (options.method === "LOSSLESS") {
          throw new PdfToolError(
            "PDF_COMPRESSION_NO_VALID_CANDIDATE",
            "Nenhum candidato sem perdas passou pelas validações.",
            error instanceof Error ? error.message : String(error),
          );
        }
        await copyFile(inputPath, reservation.temporaryPath);
        outcome = "UNCHANGED";
      }
    } else if (plan.strategy === "IMAGE_RECOMPRESSION") {
      if (!profile) {
        throw new PdfToolError(
          "PDF_COMPRESSION_ANALYSIS_REQUIRED",
          "A recompressão de imagens requer análise autoritativa do PDF.",
        );
      }
      const candidates = await buildPreservingImageCandidates({
        inputPath,
        baseOutputPath: preservingBase,
        options: plan.effectiveOptions,
        profile,
      });
      try {
        await optimizePdfStructure(inputPath, structuralPath);
        await validateStructuralCandidate(inputPath, structuralPath);
        await validateSemanticCandidate(inputPath, structuralPath, {
          visual: false,
        });
        candidates.push(structuralPath);
      } catch {
        // O candidato estrutural é opcional.
      }
      semanticValidated = candidates.length > 0;
      outcome = await selectCandidateOrOriginal({
        candidates,
        destinationPath: reservation.temporaryPath,
        inputPath,
      });
    } else {
      outcome = await withRasterCompressionSlot(async () => {
        await rasterizePdfForCompression({
          inputPath,
          options: plan.effectiveOptions,
          outputPath: rasterPath,
          onProgress: (progress) => onProgress?.(10 + progress * 0.75),
        });
        const candidates = [rasterPath];
        try {
          await optimizePdfStructure(rasterPath, qpdfRasterPath);
          await validateStructuralCandidate(rasterPath, qpdfRasterPath);
          candidates.push(qpdfRasterPath);
        } catch {
          // raster bruto continua candidato
        }
        if (
          await optimizeMonochromeRasterCandidate({
            inputPath: rasterPath,
            outputPath: monoRasterPath,
            options: plan.effectiveOptions,
          })
        ) {
          try {
            await validateStructuralCandidate(rasterPath, monoRasterPath);
            candidates.push(monoRasterPath);
          } catch {
            // CCITT inválido é descartado
          }
        }
        return selectCandidateOrOriginal({
          candidates,
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
      });
    }

    await onProgress?.(95);
    const committed = await commitPdfOutput(reservation);
    const changed = outcome === "COMPRESSED";
    const visualFields =
      outcome === "UNCHANGED" && plan.strategy !== "SKIP"
        ? ["dpi", "colorMode", "imageQuality", "monochromeThreshold"]
        : [];
    const notApplied = [...new Set([...plan.notApplied, ...visualFields])];
    const planReason =
      outcome === "UNCHANGED" && plan.strategy !== "SKIP"
        ? "O candidato não atingiu o ganho mínimo ou não passou integralmente pelas validações; o original foi preservado."
        : plan.reason;

    await onProgress?.(100);
    return {
      ...committed,
      outcome,
      strategy: plan.strategy,
      analysis: profile,
      planReason,
      requestedOptions: options,
      appliedOptions: changed ? plan.effectiveOptions : null,
      notApplied,
      preservation: {
        textLayer: plan.strategy !== "RASTER" || !profile?.hasOcrLayer,
        annotations: plan.strategy !== "RASTER",
        forms: plan.strategy !== "RASTER",
        bookmarks: plan.strategy !== "RASTER",
        metadata: plan.strategy !== "RASTER",
        semanticValidated,
      },
      textLayerPreserved:
        plan.strategy !== "RASTER" || !profile?.hasOcrLayer,
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
