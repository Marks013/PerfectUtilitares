// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_ADAPTIVE_V4_2
import { copyFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { analyzePdfCompressionProfile } from "./compression-analyzer";
import { withRasterCompressionSlot } from "./compression-concurrency";
import {
  buildPreservingImageCandidates,
  hasRequiredPdfSavings,
  optimizeMonochromeRasterCandidate,
  type PdfCompressionCandidate,
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

function visualMinimumSavingsRatio() {
  const configured = Number(
    process.env.PDF_COMPRESSION_MIN_VISUAL_SAVINGS_RATIO ?? 0.03,
  );
  return Number.isFinite(configured) && configured >= 0.01 && configured <= 0.4
    ? configured
    : 0.03;
}

export function minimumSavingsRatioForCandidate(
  candidate: Pick<PdfCompressionCandidate, "lossy" | "visualTransform">,
) {
  return candidate.lossy || candidate.visualTransform
    ? Math.max(minimumSavingsRatio(), visualMinimumSavingsRatio())
    : minimumSavingsRatio();
}

function genericCandidate(
  path: string,
  kind: PdfCompressionCandidate["kind"],
  description: string,
  flags: {
    visualTransform?: boolean;
    lossy?: boolean;
  } = {},
): PdfCompressionCandidate {
  return {
    path,
    kind,
    engine: kind === "STRUCTURAL" ? "qpdf" : "internal",
    description,
    visualTransform: flags.visualTransform ?? false,
    lossy: flags.lossy ?? false,
    notApplied: [],
  };
}

async function selectCandidateOrOriginal({
  candidates,
  destinationPath,
  inputPath,
}: {
  candidates: PdfCompressionCandidate[];
  destinationPath: string;
  inputPath: string;
}) {
  const input = await stat(inputPath);
  const existing: Array<{
    candidate: PdfCompressionCandidate;
    size: number;
  }> = [];
  for (const candidate of candidates) {
    try {
      existing.push({ candidate, size: (await stat(candidate.path)).size });
    } catch {
      // candidato ausente/descartado
    }
  }
  const eligible = existing.filter(({ candidate, size }) => {
    return hasRequiredPdfSavings(
      input.size,
      size,
      minimumSavingsRatioForCandidate(candidate),
    );
  });
  eligible.sort((left, right) => left.size - right.size);
  const best = eligible[0];
  if (!best) {
    await copyFile(inputPath, destinationPath);
    return {
      outcome: "UNCHANGED" as const,
      selectedCandidate: null,
    };
  }
  await copyFile(best.candidate.path, destinationPath);
  return {
    outcome: "COMPRESSED" as const,
    selectedCandidate: best.candidate,
  };
}

async function hasEligibleAdaptiveMonoCandidate(
  inputPath: string,
  candidates: PdfCompressionCandidate[],
) {
  const adaptive = candidates.find(
    (candidate) => candidate.kind === "MONO_XOBJECT_JBIG2",
  );
  if (!adaptive) return false;
  try {
    const [input, output] = await Promise.all([
      stat(inputPath),
      stat(adaptive.path),
    ]);
    return hasRequiredPdfSavings(
      input.size,
      output.size,
      minimumSavingsRatioForCandidate(adaptive),
    );
  } catch {
    return false;
  }
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
    `${preservingBase}.mono-jbig2.pdf`,
    `${preservingBase}.mono-xobject-jbig2.pdf`,
    `${preservingBase}.deep-opt.pdf`,
    `${preservingBase}.ocr-opt.pdf`,
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
    let selectedCandidate: PdfCompressionCandidate | null = null;
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
        const selection = await selectCandidateOrOriginal({
          candidates: [
            genericCandidate(
              structuralPath,
              "STRUCTURAL",
              "Compactação estrutural lossless com qpdf.",
            ),
          ],
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
        outcome = selection.outcome;
        selectedCandidate = selection.selectedCandidate;
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
      const candidates = await withRasterCompressionSlot(() =>
        buildPreservingImageCandidates({
          inputPath,
          baseOutputPath: preservingBase,
          options: plan.effectiveOptions,
          profile,
          minimumAdaptiveMonoSavingsRatio:
            minimumSavingsRatioForCandidate({
              visualTransform: true,
              lossy: true,
            }),
        }),
      );
      if (!(await hasEligibleAdaptiveMonoCandidate(inputPath, candidates))) {
        try {
          await optimizePdfStructure(inputPath, structuralPath);
          await validateStructuralCandidate(inputPath, structuralPath);
          await validateSemanticCandidate(inputPath, structuralPath, {
            visual: false,
          });
          candidates.push(
            genericCandidate(
              structuralPath,
              "STRUCTURAL",
              "Compactação estrutural lossless com qpdf.",
            ),
          );
        } catch {
          // O candidato estrutural é opcional.
        }
      }
      semanticValidated = candidates.length > 0;
      const selection = await selectCandidateOrOriginal({
        candidates,
        destinationPath: reservation.temporaryPath,
        inputPath,
      });
      outcome = selection.outcome;
      selectedCandidate = selection.selectedCandidate;
    } else {
      outcome = await withRasterCompressionSlot(async () => {
        await rasterizePdfForCompression({
          inputPath,
          options: plan.effectiveOptions,
          outputPath: rasterPath,
          onProgress: (progress) => onProgress?.(10 + progress * 0.75),
        });
        const candidates: PdfCompressionCandidate[] = [
          genericCandidate(
            rasterPath,
            "RASTER",
            "Rasterização explícita conforme os parâmetros solicitados.",
            { visualTransform: true, lossy: true },
          ),
        ];
        try {
          await optimizePdfStructure(rasterPath, qpdfRasterPath);
          await validateStructuralCandidate(rasterPath, qpdfRasterPath);
          candidates.push(
            genericCandidate(
              qpdfRasterPath,
              "RASTER",
              "Rasterização explícita seguida de compactação estrutural qpdf.",
              { visualTransform: true, lossy: true },
            ),
          );
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
            candidates.push(
              genericCandidate(
                monoRasterPath,
                "RASTER",
                "Rasterização monocromática explícita com compactação bilevel.",
                { visualTransform: true, lossy: true },
              ),
            );
          } catch {
            // CCITT inválido é descartado
          }
        }
        const selection = await selectCandidateOrOriginal({
          candidates,
          destinationPath: reservation.temporaryPath,
          inputPath,
        });
        selectedCandidate = selection.selectedCandidate;
        return selection.outcome;
      });
    }

    await onProgress?.(95);
    let resultAnalysis = null;
    if (
      outcome === "COMPRESSED" &&
      selectedCandidate &&
      plan.strategy === "IMAGE_RECOMPRESSION"
    ) {
      resultAnalysis = await analyzePdfCompressionProfile(
        reservation.temporaryPath,
      ).catch(() => null);
    }
    const committed = await commitPdfOutput(reservation);
    const changed = outcome === "COMPRESSED";
    const visualFields =
      outcome === "UNCHANGED" && plan.strategy !== "SKIP"
        ? ["dpi", "colorMode", "imageQuality", "monochromeThreshold"]
        : [];
    const winnerDidNotApplyVisualPlan =
      changed &&
      plan.strategy === "IMAGE_RECOMPRESSION" &&
      selectedCandidate !== null &&
      !selectedCandidate.visualTransform
        ? ["dpi", "colorMode", "imageQuality", "monochromeThreshold"]
        : [];
    const analysisUnavailable =
      changed &&
      plan.strategy === "IMAGE_RECOMPRESSION" &&
      selectedCandidate?.visualTransform &&
      !resultAnalysis
        ? ["dpi", "colorMode", "imageQuality", "monochromeThreshold"]
        : [];
    const notApplied = [
      ...new Set([
        ...plan.notApplied,
        ...visualFields,
        ...winnerDidNotApplyVisualPlan,
        ...analysisUnavailable,
        ...(selectedCandidate?.notApplied ?? []),
      ]),
    ];
    const planReason =
      outcome === "UNCHANGED" && plan.strategy !== "SKIP"
        ? "Nenhum candidato atingiu o ganho mínimo adequado ao tipo de transformação e passou integralmente pelas validações; o original foi preservado."
        : selectedCandidate
          ? selectedCandidate.description
          : plan.reason;
    const appliedOptions =
      !changed
        ? null
        : plan.strategy === "RASTER"
          ? plan.effectiveOptions
          : plan.strategy === "IMAGE_RECOMPRESSION" &&
              selectedCandidate?.visualTransform &&
              resultAnalysis
            ? {
                ...plan.effectiveOptions,
                dpi: resultAnalysis.sourceDpi ?? plan.effectiveOptions.dpi,
                colorMode: resultAnalysis.colorMode,
                monochromeThreshold:
                  selectedCandidate.appliedMonochromeThreshold ??
                  plan.effectiveOptions.monochromeThreshold,
              }
            : null;
    const resultStrategy =
      selectedCandidate?.kind === "STRUCTURAL"
        ? "STRUCTURAL"
        : plan.strategy;

    await onProgress?.(100);
    return {
      ...committed,
      outcome,
      strategy: resultStrategy,
      analysis: profile,
      planReason,
      requestedOptions: options,
      appliedOptions,
      selectedCandidate:
        changed && selectedCandidate
          ? {
              kind: selectedCandidate.kind,
              engine: selectedCandidate.engine,
              description: selectedCandidate.description,
              visualTransform: selectedCandidate.visualTransform,
              lossy: selectedCandidate.lossy,
              encoding: resultAnalysis?.predominantImageEncoding ?? null,
              dpi: resultAnalysis?.sourceDpi ?? null,
              colorMode: resultAnalysis?.colorMode ?? null,
            }
          : null,
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
