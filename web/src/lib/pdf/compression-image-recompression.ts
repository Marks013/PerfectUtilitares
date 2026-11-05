// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_ADAPTIVE_V4_2
import {
  compressionToolTimeoutMs,
  runCompressionTool as runTool,
} from "./compression-process";
import { rm, stat } from "node:fs/promises";
import type { PdfCompressionProfile } from "./compression-analyzer";
import type {
  PdfCompressionColorMode,
  PdfCompressionEffectiveOptions,
} from "./compression-types";
import { PdfToolError } from "./compression-types";
import { validateSemanticCandidate } from "./compression-semantic";

type PdfCompressionCandidateKind =
  | "STRUCTURAL"
  | "QPDF_IMAGE_OPTIMIZE"
  | "GS_IMAGE_RECOMPRESSION"
  | "GS_OCRMYPDF_DEEP"
  | "MONO_JBIG2"
  | "MONO_XOBJECT_JBIG2"
  | "JPEG_XOBJECT_RECOMPRESSION"
  | "OCRMYPDF_LOSSLESS"
  | "RASTER";

export type PdfCompressionCandidate = {
  path: string;
  kind: PdfCompressionCandidateKind;
  engine: string;
  description: string;
  // true somente quando o candidato aplica de fato DPI/tonalidade do plano.
  visualTransform: boolean;
  // true se algum estágio puder alterar amostras de imagem.
  lossy: boolean;
  appliedMonochromeThreshold?: number;
  notApplied: string[];
};

export function hasEarlyJpegSavings(inputBytes: number, outputBytes: number) {
  return outputBytes > 0 && outputBytes <= Math.floor(inputBytes * 0.85);
}

export function hasRequiredPdfSavings(
  inputBytes: number,
  candidateBytes: number,
  minimumSavingsRatio: number,
) {
  if (
    !Number.isFinite(inputBytes) ||
    !Number.isFinite(candidateBytes) ||
    !Number.isFinite(minimumSavingsRatio) ||
    inputBytes <= 0 ||
    candidateBytes <= 0 ||
    minimumSavingsRatio < 0 ||
    minimumSavingsRatio >= 1
  ) {
    return false;
  }
  return (
    candidateBytes < Math.floor(inputBytes * (1 - minimumSavingsRatio))
  );
}

async function validateSmallerCandidate(inputPath: string, outputPath: string) {
  const [input, output] = await Promise.all([stat(inputPath), stat(outputPath)]);
  // A candidate that is not smaller can never win. Avoid expensive rendering
  // and semantic extraction, but never bypass them for a possible winner.
  if (!hasRequiredPdfSavings(input.size, output.size, 0)) {
    throw new PdfToolError(
      "PDF_COMPRESSION_NO_GAIN",
      "Este candidato não reduziu o arquivo; outras alternativas serão avaliadas.",
    );
  }
  await validateSemanticCandidate(inputPath, outputPath);
}


function candidate(
  value: Omit<PdfCompressionCandidate, "notApplied"> & {
    notApplied?: string[];
  },
): PdfCompressionCandidate {
  return { ...value, notApplied: value.notApplied ?? [] };
}

async function qpdfImageCandidate(
  inputPath: string,
  outputPath: string,
  options: PdfCompressionEffectiveOptions,
) {
  const baseArgs = [
    "--object-streams=generate",
    "--compress-streams=y",
    "--decode-level=generalized",
    "--recompress-flate",
    "--compression-level=9",
    "--optimize-images",
  ];
  try {
    await runTool("qpdf", [
      ...baseArgs,
      `--jpeg-quality=${options.imageQuality}`,
      "--",
      inputPath,
      outputPath,
    ]);
  } catch {
    await runTool("qpdf", [...baseArgs, "--", inputPath, outputPath]);
  }
  await validateSmallerCandidate(inputPath, outputPath);
}

export function resolveSafeGhostscriptColorMode(
  options: PdfCompressionEffectiveOptions,
  profile: PdfCompressionProfile,
): PdfCompressionColorMode {
  // pdfwrite consegue converter cor para cinza, mas não fornece um threshold
  // preservador confiável de 8-bit -> 1-bit. AUTO nunca deve fingir que fez
  // MONOCHROME em um documento que não era bilevel. O threshold verdadeiro
  // continua reservado ao método RASTER, que exige opt-in para perda semântica.
  if (
    options.colorMode === "MONOCHROME" &&
    profile.colorMode !== "MONOCHROME"
  ) {
    return "GRAYSCALE";
  }
  return options.colorMode;
}

export function buildGhostscriptImageArgs({
  inputPath,
  outputPath,
  options,
  profile,
}: {
  inputPath: string;
  outputPath: string;
  options: PdfCompressionEffectiveOptions;
  profile: PdfCompressionProfile;
}) {
  const colorMode = resolveSafeGhostscriptColorMode(options, profile);
  const args = [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.7",
    "-dAutoRotatePages=/None",
    "-dPreserveAnnots=true",
    "-dPreserveMarkedContent=true",
    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dDownsampleColorImages=true",
    "-dDownsampleGrayImages=true",
    "-dDownsampleMonoImages=true",
    "-dColorImageDownsampleType=/Bicubic",
    "-dGrayImageDownsampleType=/Bicubic",
    "-dMonoImageDownsampleType=/Subsample",
    // O default do pdfwrite é conservador demais para 250 -> 150/220 DPI.
    "-dColorImageDownsampleThreshold=1.05",
    "-dGrayImageDownsampleThreshold=1.05",
    "-dMonoImageDownsampleThreshold=1.05",
    `-dColorImageResolution=${options.dpi}`,
    `-dGrayImageResolution=${options.dpi}`,
    `-dMonoImageResolution=${options.dpi}`,
    "-dAutoFilterColorImages=false",
    "-dAutoFilterGrayImages=false",
    "-dColorImageFilter=/DCTEncode",
    "-dGrayImageFilter=/DCTEncode",
    "-dPassThroughJPEGImages=false",
    "-dPassThroughJPXImages=false",
    `-dJPEGQ=${options.imageQuality}`,
  ];

  if (colorMode === "GRAYSCALE") {
    args.push(
      "-sColorConversionStrategy=Gray",
      "-dProcessColorModel=/DeviceGray",
    );
  } else if (colorMode === "MONOCHROME") {
    // Ghostscript não possui encoder JBIG2. CCITT é apenas o estágio
    // intermediário; o candidato MONO_JBIG2 abaixo reencoda lossless.
    args.push(
      "-sColorConversionStrategy=Gray",
      "-dProcessColorModel=/DeviceGray",
      "-dMonoImageFilter=/CCITTFaxEncode",
    );
  } else {
    args.push("-sColorConversionStrategy=LeaveColorUnchanged");
  }

  args.push(`-sOutputFile=${outputPath}`, inputPath);
  return args;
}

async function ghostscriptCandidate(
  inputPath: string,
  outputPath: string,
  options: PdfCompressionEffectiveOptions,
  profile: PdfCompressionProfile,
) {
  await runTool(
    "gs",
    buildGhostscriptImageArgs({ inputPath, outputPath, options, profile }),
  );
  // This can also feed the OCRmyPDF optimizer. A larger intermediate may still
  // produce a smaller final candidate; do not prune the pipeline at this stage.
  await validateSemanticCandidate(inputPath, outputPath);
}

function deepOptimizationEnabled() {
  return process.env.PDF_COMPRESSION_DEEP_OPTIMIZATION !== "false";
}

export function ocrMyPdfOptimizationLevel(
  options: PdfCompressionEffectiveOptions,
  colorMode: PdfCompressionColorMode,
) {
  // JBIG2 sempre lossless. Evita substituição de símbolos/dígitos.
  if (colorMode === "MONOCHROME") return 1;
  if (options.quality === "SCREEN") return 3;
  if (options.quality === "PRINT") return 1;
  if (options.quality === "BALANCED") return 2;
  return options.imageQuality <= 65 ? 3 : options.imageQuality <= 82 ? 2 : 1;
}

export function buildOcrMyPdfOptimizerArgs({
  inputPath,
  outputPath,
  options,
  colorMode,
}: {
  inputPath: string;
  outputPath: string;
  options: PdfCompressionEffectiveOptions;
  colorMode: PdfCompressionColorMode;
}) {
  const level = ocrMyPdfOptimizationLevel(options, colorMode);
  const args = [
    "--skip-text",
    "--language",
    "por+eng",
    "--tesseract-timeout",
    "0",
    "--output-type",
    "pdf",
    "--optimize",
    String(level),
    "--fast-web-view",
    "999999",
    "--jobs",
    "1",
  ];
  if (colorMode !== "MONOCHROME" && level >= 2) {
    args.push("--jpeg-quality", String(options.imageQuality));
  }
  args.push(inputPath, outputPath);
  return args;
}

async function ocrMyPdfOptimizeCandidate({
  originalPath,
  inputPath,
  outputPath,
  options,
  colorMode,
}: {
  originalPath: string;
  inputPath: string;
  outputPath: string;
  options: PdfCompressionEffectiveOptions;
  colorMode: PdfCompressionColorMode;
}) {
  await runTool(
    "ocrmypdf",
    buildOcrMyPdfOptimizerArgs({
      inputPath,
      outputPath,
      options,
      colorMode,
    }),
    // This is an optional refinement. Never spend the full tool budget
    // repeating image optimization after a preserving candidate is available.
    Math.min(compressionToolTimeoutMs(), 30_000),
  );
  // Validação sempre contra o original, não contra o intermediário.
  await validateSmallerCandidate(originalPath, outputPath);
}

export function resolveAdaptiveMonoXObjectTargetDpi(
  profile: PdfCompressionProfile,
  options: PdfCompressionEffectiveOptions,
) {
  if (
    profile.optimizationClass !== "OPTIMIZED_MONO" ||
    profile.predominantImageEncoding !== "JBIG2" ||
    profile.bitsPerComponent !== 1 ||
    profile.colorMode !== "MONOCHROME" ||
    options.colorMode !== "MONOCHROME" ||
    profile.sourceDpi === null ||
    profile.sourceDpi <= options.dpi
  ) {
    return null;
  }

  const targetDpi = Math.max(72, options.dpi);

  return targetDpi < profile.sourceDpi ? targetDpi : null;
}

export function resolveAdaptiveMonoXObjectThreshold(
  options: PdfCompressionEffectiveOptions,
) {
  return options.monochromeThreshold;
}

async function monoXObjectJbig2Candidate({
  inputPath,
  outputPath,
  sourceDpi,
  targetDpi,
  threshold,
}: {
  inputPath: string;
  outputPath: string;
  sourceDpi: number;
  targetDpi: number;
  threshold: number;
}) {
  await runTool("python3", [
    process.env.PDF_MONO_XOBJECT_RESAMPLER ??
      "/app/mono-xobject-resample.py",
    inputPath,
    outputPath,
    "--source-dpi",
    String(sourceDpi),
    "--target-dpi",
    String(targetDpi),
    "--threshold",
    String(threshold),
  ]);
  await validateSmallerCandidate(inputPath, outputPath);
}

export async function buildPreservingImageCandidates({
  inputPath,
  baseOutputPath,
  options,
  profile,
  minimumAdaptiveMonoSavingsRatio = 0.03,
  onIntegrityRejection,
}: {
  inputPath: string;
  baseOutputPath: string;
  options: PdfCompressionEffectiveOptions;
  profile: PdfCompressionProfile;
  minimumAdaptiveMonoSavingsRatio?: number;
  onIntegrityRejection?: () => void;
}) {
  const candidates: PdfCompressionCandidate[] = [];
  const reportIntegrityRejection = (error: unknown) => {
    if (
      error instanceof PdfToolError &&
      [
        "PDF_SEMANTIC_INTEGRITY_FAILED",
        "PDF_VISUAL_INTEGRITY_FAILED",
        "PDF_STRUCTURAL_INTEGRITY_FAILED",
      ].includes(error.code)
    ) {
      onIntegrityRejection?.();
    }
  };

  if (
    (profile.contentKind === "SCANNED" || profile.contentKind === "SCANNED_OCR") &&
    profile.predominantImageEncoding === "JPEG" &&
    profile.bitsPerComponent === 8 &&
    options.colorMode !== "MONOCHROME" &&
    (options.colorMode !== "COLOR" || profile.colorMode === "COLOR") &&
    ((profile.sourceDpi !== null && profile.sourceDpi > options.dpi) ||
      (options.colorMode === "GRAYSCALE" && profile.colorMode === "COLOR") ||
      options.userOverrides.imageQuality)
  ) {
    const jpegPath = `${baseOutputPath}.jpeg-xobjects.pdf`;
    try {
      await runTool(
        "python3",
        [
          process.env.PDF_JPEG_XOBJECT_RESAMPLER ??
            "/app/jpeg-xobject-resample.py",
          inputPath,
          jpegPath,
          "--target-dpi",
          String(options.dpi),
          "--quality",
          String(options.imageQuality),
          "--mode",
          options.colorMode === "GRAYSCALE" ? "grayscale" : "preserve",
        ],
        Math.min(compressionToolTimeoutMs(), 30_000),
      );
      const [input, output] = await Promise.all([
        stat(inputPath),
        stat(jpegPath),
      ]);
      if (
        output.size > 0 &&
        hasRequiredPdfSavings(
          input.size,
          output.size,
          minimumAdaptiveMonoSavingsRatio,
        )
      ) {
        await validateSemanticCandidate(inputPath, jpegPath);
        candidates.push(
          candidate({
            path: jpegPath,
            kind: "JPEG_XOBJECT_RECOMPRESSION",
            engine: "pikepdf + Pillow",
            description:
              "Imagens JPEG recomprimidas sem reescrever as páginas; texto e OCR preservados.",
            visualTransform: true,
            lossy: true,
          }),
        );
        if (hasEarlyJpegSavings(input.size, output.size)) return candidates;
      }
    } catch (error) {
      reportIntegrityRejection(error);
    }
    if (!candidates.length) {
      await rm(jpegPath, { force: true }).catch(() => undefined);
    }
  }

  const adaptiveMonoTargetDpi = resolveAdaptiveMonoXObjectTargetDpi(
    profile,
    options,
  );
  if (adaptiveMonoTargetDpi !== null && profile.sourceDpi !== null) {
    const monoXObjectPath = `${baseOutputPath}.mono-xobject-jbig2.pdf`;
    const adaptiveThreshold = resolveAdaptiveMonoXObjectThreshold(options);
    try {
      await monoXObjectJbig2Candidate({
        inputPath,
        outputPath: monoXObjectPath,
        sourceDpi: profile.sourceDpi,
        targetDpi: adaptiveMonoTargetDpi,
        threshold: adaptiveThreshold,
      });
      candidates.push(
        candidate({
          path: monoXObjectPath,
          kind: "MONO_XOBJECT_JBIG2",
          engine: "pikepdf + Pillow + jbig2enc",
          description:
            `XObjects monocromáticos reamostrados de forma adaptativa para ${adaptiveMonoTargetDpi} DPI e reencodados em JBIG2 generic lossless; páginas e camada OCR originais foram preservadas.`,
          visualTransform: true,
          lossy: true,
          appliedMonochromeThreshold: adaptiveThreshold,
          notApplied: ["imageQuality"],
        }),
      );
      const [input, output] = await Promise.all([
        stat(inputPath),
        stat(monoXObjectPath),
      ]);
      if (
        hasRequiredPdfSavings(
          input.size,
          output.size,
          minimumAdaptiveMonoSavingsRatio,
        )
      ) {
        return candidates;
      }
    } catch (error) {
      reportIntegrityRejection(error);
      await rm(monoXObjectPath, { force: true }).catch(() => undefined);
    }
  }

  const qpdfPath = `${baseOutputPath}.qpdf-images.pdf`;
  try {
    await qpdfImageCandidate(inputPath, qpdfPath, options);
    candidates.push(
      candidate({
        path: qpdfPath,
        kind: "QPDF_IMAGE_OPTIMIZE",
        engine: "qpdf",
        description:
          "Otimização de streams/imagens com qpdf; DPI e tonalidade só são declarados quando efetivamente aplicados.",
        visualTransform: false,
        // qpdf --optimize-images pode transcoder amostras para JPEG.
        lossy: true,
      }),
    );
  } catch (error) {
    reportIntegrityRejection(error);
    await rm(qpdfPath, { force: true }).catch(() => undefined);
  }

  const needsDownsample =
    profile.sourceDpi !== null && options.dpi < profile.sourceDpi;
  const needsColor = options.colorMode !== profile.colorMode;
  const imageWork =
    needsDownsample ||
    needsColor ||
    options.userOverrides.imageQuality ||
    options.userOverrides.monochromeThreshold ||
    profile.predominantImageEncoding === "FLATE" ||
    profile.predominantImageEncoding === "OTHER";

  if (imageWork && adaptiveMonoTargetDpi === null) {
    const safeColorMode = resolveSafeGhostscriptColorMode(options, profile);
    const notApplied =
      options.colorMode === "MONOCHROME" && safeColorMode !== "MONOCHROME"
        ? ["colorMode", "monochromeThreshold"]
        : [];
    const gsPath = `${baseOutputPath}.gs-images.pdf`;
    try {
      await ghostscriptCandidate(inputPath, gsPath, options, profile);
      candidates.push(
        candidate({
          path: gsPath,
          kind: "GS_IMAGE_RECOMPRESSION",
          engine: "ghostscript",
          description:
            safeColorMode === "MONOCHROME"
              ? "Reamostragem bilevel preservadora; CCITT foi usado como estágio/fallback seguro."
              : safeColorMode === "GRAYSCALE"
                ? "Reamostragem em tons de cinza com DCT/JPEG controlado e DPI efetivo."
                : "Reamostragem colorida com DCT/JPEG controlado e DPI efetivo.",
          visualTransform: true,
          lossy: needsDownsample || needsColor || safeColorMode !== "MONOCHROME",
          notApplied,
        }),
      );

      const [input, gsOutput] = await Promise.all([stat(inputPath), stat(gsPath)]);
      // Color/grayscale already uses the requested JPEG quality. Further lossy
      // optimization adds latency with little value after a meaningful reduction.
      // Keep bilevel refinement: lossless JBIG2 can still provide a large gain.
      const needsDeepRefinement = safeColorMode === "MONOCHROME" ||
        !hasEarlyJpegSavings(input.size, gsOutput.size);
      if (deepOptimizationEnabled() && profile.hasSelectableText && needsDeepRefinement) {
        const deepPath =
          safeColorMode === "MONOCHROME"
            ? `${baseOutputPath}.mono-jbig2.pdf`
            : `${baseOutputPath}.deep-opt.pdf`;
        try {
          await ocrMyPdfOptimizeCandidate({
            originalPath: inputPath,
            inputPath: gsPath,
            outputPath: deepPath,
            options,
            colorMode: safeColorMode,
          });
          candidates.push(
            candidate({
              path: deepPath,
              kind:
                safeColorMode === "MONOCHROME"
                  ? "MONO_JBIG2"
                  : "GS_OCRMYPDF_DEEP",
              engine:
                safeColorMode === "MONOCHROME"
                  ? "ghostscript + ocrmypdf/jbig2enc"
                  : "ghostscript + ocrmypdf",
              description:
                safeColorMode === "MONOCHROME"
                  ? "Imagem bilevel reamostrada e reencodada em JBIG2 lossless; a camada OCR original foi preservada."
                  : "Reamostragem DCT seguida do otimizador de imagens OCRmyPDF; o candidato só é aceito após validação semântica/visual.",
              visualTransform: true,
              lossy: needsDownsample || needsColor || safeColorMode !== "MONOCHROME",
              notApplied,
            }),
          );
        } catch (error) {
          reportIntegrityRejection(error);
          await rm(deepPath, { force: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      reportIntegrityRejection(error);
      await rm(gsPath, { force: true }).catch(() => undefined);
    }
  } else if (
    deepOptimizationEnabled() &&
    profile.colorMode === "MONOCHROME" &&
    profile.hasSelectableText &&
    profile.predominantImageEncoding !== "JBIG2"
  ) {
    // Sem downsample: CCITT/Flate -> JBIG2 lossless quando trouxer ganho.
    const optimizedPath = `${baseOutputPath}.ocr-opt.pdf`;
    try {
      await ocrMyPdfOptimizeCandidate({
        originalPath: inputPath,
        inputPath,
        outputPath: optimizedPath,
        options,
        colorMode: "MONOCHROME",
      });
      candidates.push(
        candidate({
          path: optimizedPath,
          kind: "OCRMYPDF_LOSSLESS",
          engine: "ocrmypdf/jbig2enc",
          description:
            "Transcodificação lossless de imagem monocromática para JBIG2 quando mais eficiente.",
          visualTransform: false,
          lossy: false,
        }),
      );
    } catch (error) {
      reportIntegrityRejection(error);
      await rm(optimizedPath, { force: true }).catch(() => undefined);
    }
  }

  return candidates;
}

export async function optimizeMonochromeRasterCandidate({
  inputPath,
  outputPath,
  options,
}: {
  inputPath: string;
  outputPath: string;
  options: PdfCompressionEffectiveOptions;
}) {
  if (options.colorMode !== "MONOCHROME") return false;
  try {
    await runTool("gs", [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.7",
      "-dMonoImageFilter=/CCITTFaxEncode",
      "-dDownsampleMonoImages=false",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);
    return (await stat(outputPath)).size > 0;
  } catch {
    return false;
  }
}
