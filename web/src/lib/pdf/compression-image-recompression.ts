// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_ADAPTIVE_V4_2
import { spawn } from "node:child_process";
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
    candidateBytes < 0 ||
    minimumSavingsRatio < 0 ||
    minimumSavingsRatio >= 1
  ) {
    return false;
  }
  return (
    candidateBytes < Math.floor(inputBytes * (1 - minimumSavingsRatio))
  );
}

function compressionToolTimeoutMs() {
  const configured = Number(
    process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS ?? 10 * 60 * 1000,
  );
  return Number.isFinite(configured) &&
    configured >= 30_000 &&
    configured <= 30 * 60 * 1000
    ? configured
    : 10 * 60 * 1000;
}

function runTool(
  executable: string,
  args: string[],
  timeoutMs = compressionToolTimeoutMs(),
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let done = false;
    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new PdfToolError(
            "PDF_COMPRESSION_TIMEOUT",
            `${executable} excedeu o tempo permitido.`,
          ),
        ),
      );
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    child.once("error", (error) =>
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfToolError(
                "PDF_TOOL_UNAVAILABLE",
                `${executable} não está instalado no worker.`,
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
                `${executable} não conseguiu gerar um candidato válido.`,
                stderr,
              ),
            ),
      ),
    );
  });
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
  await validateSemanticCandidate(inputPath, outputPath);
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
  );
  // Validação sempre contra o original, não contra o intermediário.
  await validateSemanticCandidate(originalPath, outputPath);
}

export function shouldUseJbig2PostOptimization(
  profile: PdfCompressionProfile,
  options: PdfCompressionEffectiveOptions,
) {
  const targetMode = resolveSafeGhostscriptColorMode(options, profile);
  if (targetMode !== "MONOCHROME" || !profile.hasSelectableText) return false;
  const needsDownsample =
    profile.sourceDpi !== null && options.dpi < profile.sourceDpi;
  return (
    needsDownsample ||
    profile.predominantImageEncoding !== "JBIG2" ||
    profile.optimizationClass !== "OPTIMIZED_MONO"
  );
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
  await validateSemanticCandidate(inputPath, outputPath);
}

export async function buildPreservingImageCandidates({
  inputPath,
  baseOutputPath,
  options,
  profile,
  minimumAdaptiveMonoSavingsRatio = 0.03,
}: {
  inputPath: string;
  baseOutputPath: string;
  options: PdfCompressionEffectiveOptions;
  profile: PdfCompressionProfile;
  minimumAdaptiveMonoSavingsRatio?: number;
}) {
  const candidates: PdfCompressionCandidate[] = [];

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
    } catch {
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
  } catch {
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

      if (deepOptimizationEnabled() && profile.hasSelectableText) {
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
        } catch {
          await rm(deepPath, { force: true }).catch(() => undefined);
        }
      }
    } catch {
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
    } catch {
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
