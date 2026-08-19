// PERFECT_PDF_FULL32_V2_2
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { PdfCompressionProfile } from "./compression-analyzer";
import type { PdfCompressionEffectiveOptions } from "./compression-types";
import { PdfToolError } from "./compression-types";
import { validateSemanticCandidate } from "./compression-semantic";

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
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
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
      if (stderr.length < 16_000) stderr += chunk;
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
    // qpdf 12.1+ permite controlar a qualidade JPEG.
    await runTool("qpdf", [
      ...baseArgs,
      `--jpeg-quality=${options.imageQuality}`,
      "--",
      inputPath,
      outputPath,
    ]);
  } catch {
    // Compatibilidade com qpdf anterior.
    await runTool("qpdf", [
      ...baseArgs,
      "--",
      inputPath,
      outputPath,
    ]);
  }
  await validateSemanticCandidate(inputPath, outputPath);
}

function gsColorStrategy(options: PdfCompressionEffectiveOptions) {
  if (options.colorMode === "GRAYSCALE") {
    return [
      "-sColorConversionStrategy=Gray",
      "-dProcessColorModel=/DeviceGray",
    ];
  }
  if (options.colorMode === "MONOCHROME") {
    return [
      "-sColorConversionStrategy=Gray",
      "-dProcessColorModel=/DeviceGray",
      "-dMonoImageDownsampleType=/Bicubic",
      `-dMonoImageResolution=${options.dpi}`,
      "-dMonoImageFilter=/CCITTFaxEncode",
    ];
  }
  return ["-sColorConversionStrategy=LeaveColorUnchanged"];
}

async function ghostscriptCandidate(
  inputPath: string,
  outputPath: string,
  options: PdfCompressionEffectiveOptions,
) {
  await runTool("gs", [
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.7",
    "-dPreserveAnnots=true",
    "-dPreserveMarkedContent=true",
    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dDownsampleColorImages=true",
    "-dDownsampleGrayImages=true",
    "-dColorImageDownsampleType=/Bicubic",
    "-dGrayImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${options.dpi}`,
    `-dGrayImageResolution=${options.dpi}`,
    `-dJPEGQ=${options.imageQuality}`,
    ...gsColorStrategy(options),
    `-sOutputFile=${outputPath}`,
    inputPath,
  ]);
  await validateSemanticCandidate(inputPath, outputPath);
}

export async function buildPreservingImageCandidates({
  inputPath,
  baseOutputPath,
  options,
  profile,
}: {
  inputPath: string;
  baseOutputPath: string;
  options: PdfCompressionEffectiveOptions;
  profile: PdfCompressionProfile;
}) {
  const candidates: string[] = [];
  const qpdfPath = `${baseOutputPath}.qpdf-images.pdf`;
  try {
    await qpdfImageCandidate(inputPath, qpdfPath, options);
    candidates.push(qpdfPath);
  } catch {
    // qpdf antigo ou candidato que não preservou semântica: não é aceito.
  }

  const needsDownsample =
    profile.sourceDpi !== null && options.dpi < profile.sourceDpi;
  const needsColor =
    options.colorMode !== profile.colorMode;
  if (needsDownsample || needsColor || options.userOverrides.imageQuality) {
    const gsPath = `${baseOutputPath}.gs-images.pdf`;
    try {
      await ghostscriptCandidate(inputPath, gsPath, options);
      candidates.push(gsPath);
    } catch {
      // Nunca aceitar um candidato GS sem validação semântica.
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
