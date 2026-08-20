// PERFECT_PDF_ADAPTIVE_V4_2
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGhostscriptImageArgs,
  buildOcrMyPdfOptimizerArgs,
  hasRequiredPdfSavings,
  ocrMyPdfOptimizationLevel,
  resolveAdaptiveMonoXObjectTargetDpi,
  resolveAdaptiveMonoXObjectThreshold,
  resolveSafeGhostscriptColorMode,
  shouldUseJbig2PostOptimization,
} from "./compression-image-recompression";
import type { PdfCompressionProfile } from "./compression-analyzer";
import type { PdfCompressionEffectiveOptions } from "./compression-types";

function options(
  overrides: Partial<PdfCompressionEffectiveOptions> = {},
): PdfCompressionEffectiveOptions {
  return {
    quality: "BALANCED",
    method: "AUTO",
    dpi: 150,
    colorMode: "MONOCHROME",
    imageQuality: 72,
    monochromeThreshold: 160,
    userOverrides: {
      method: false,
      dpi: false,
      colorMode: false,
      imageQuality: false,
      monochromeThreshold: false,
    },
    preserveTextLayer: true,
    allowSemanticLoss: false,
    ...overrides,
  };
}

function profile(
  overrides: Partial<PdfCompressionProfile> = {},
): PdfCompressionProfile {
  return {
    pageCount: 150,
    sampledPages: [1, 38, 75, 113, 150],
    contentKind: "SCANNED_OCR",
    colorMode: "MONOCHROME",
    sourceDpi: 250,
    minimumDpi: 250,
    maximumDpi: 250,
    fullPageImageRatio: 1,
    imageCoverageRatio: 1,
    imageCount: 150,
    hasSelectableText: true,
    hasOcrLayer: true,
    predominantImageEncoding: "JBIG2",
    bitsPerComponent: 1,
    alreadyOptimized: true,
    optimizationClass: "OPTIMIZED_MONO",
    ...overrides,
  };
}

describe("adaptive PDF compression v4.2", () => {
  it("faz downsample P&B e prepara pós-otimização JBIG2 lossless", () => {
    const opts = options();
    const source = profile();
    expect(shouldUseJbig2PostOptimization(source, opts)).toBe(true);
    const args = buildGhostscriptImageArgs({
      inputPath: "/tmp/in.pdf",
      outputPath: "/tmp/out.pdf",
      options: opts,
      profile: source,
    });
    expect(args).toContain("-dMonoImageResolution=150");
    expect(args).toContain("-dMonoImageFilter=/CCITTFaxEncode");
    expect(args).toContain("-dMonoImageDownsampleThreshold=1.05");
    expect(args).toContain("-dMonoImageDownsampleType=/Subsample");
  });

  it("usa caminho XObject adaptativo para JBIG2 já otimizado", () => {
    const source = profile();
    const opts = options();
    expect(resolveAdaptiveMonoXObjectTargetDpi(source, opts)).toBe(150);
    expect(resolveAdaptiveMonoXObjectThreshold(opts)).toBe(160);
  });

  it("encerra o fast path apenas quando o ganho visual mínimo é atingido", () => {
    expect(hasRequiredPdfSavings(10_000, 9_699, 0.03)).toBe(true);
    expect(hasRequiredPdfSavings(10_000, 9_700, 0.03)).toBe(false);
    expect(hasRequiredPdfSavings(10_000, 4_500, 0.03)).toBe(true);
    expect(hasRequiredPdfSavings(0, 0, 0.03)).toBe(false);
    expect(hasRequiredPdfSavings(10_000, 4_500, 1)).toBe(false);
  });

  it("respeita overrides explícitos no caminho XObject monocromático", () => {
    const source = profile();
    const opts = options({
      dpi: 165,
      monochromeThreshold: 172,
      userOverrides: {
        method: false,
        dpi: true,
        colorMode: false,
        imageQuality: false,
        monochromeThreshold: true,
      },
    });
    expect(resolveAdaptiveMonoXObjectTargetDpi(source, opts)).toBe(165);
    expect(resolveAdaptiveMonoXObjectThreshold(opts)).toBe(172);
  });

  it("não usa XObject adaptativo fora de OPTIMIZED_MONO/JBIG2 bilevel", () => {
    expect(
      resolveAdaptiveMonoXObjectTargetDpi(
        profile({
          optimizationClass: "RECOMPRESSIBLE_JPEG",
          predominantImageEncoding: "JPEG",
          bitsPerComponent: 8,
        }),
        options(),
      ),
    ).toBeNull();
  });

  it("não finge threshold 1-bit de uma origem 8-bit no AUTO", () => {
    const source = profile({
      colorMode: "GRAYSCALE",
      bitsPerComponent: 8,
      predominantImageEncoding: "JPEG",
      alreadyOptimized: false,
      optimizationClass: "RECOMPRESSIBLE_JPEG",
    });
    expect(resolveSafeGhostscriptColorMode(options(), source)).toBe("GRAYSCALE");
    expect(shouldUseJbig2PostOptimization(source, options())).toBe(false);
  });

  it("força DCT/JPEG e downsample efetivo para tons de cinza", () => {
    const opts = options({
      colorMode: "GRAYSCALE",
      dpi: 150,
      imageQuality: 70,
    });
    const source = profile({
      colorMode: "GRAYSCALE",
      bitsPerComponent: 8,
      predominantImageEncoding: "JPEG",
      alreadyOptimized: false,
      optimizationClass: "RECOMPRESSIBLE_JPEG",
    });
    const args = buildGhostscriptImageArgs({
      inputPath: "/tmp/in.pdf",
      outputPath: "/tmp/out.pdf",
      options: opts,
      profile: source,
    });
    expect(args).toContain("-dAutoFilterGrayImages=false");
    expect(args).toContain("-dGrayImageFilter=/DCTEncode");
    expect(args).toContain("-dGrayImageResolution=150");
    expect(args).toContain("-dGrayImageDownsampleThreshold=1.05");
    expect(args).toContain("-dJPEGQ=70");
  });

  it("força DCT/JPEG controlado para colorido sem converter a tonalidade", () => {
    const opts = options({
      colorMode: "COLOR",
      dpi: 150,
      imageQuality: 72,
    });
    const source = profile({
      colorMode: "COLOR",
      bitsPerComponent: 8,
      predominantImageEncoding: "JPEG",
      alreadyOptimized: false,
      optimizationClass: "RECOMPRESSIBLE_JPEG",
    });
    const args = buildGhostscriptImageArgs({
      inputPath: "/tmp/in.pdf",
      outputPath: "/tmp/out.pdf",
      options: opts,
      profile: source,
    });
    expect(args).toContain("-sColorConversionStrategy=LeaveColorUnchanged");
    expect(args).toContain("-dAutoFilterColorImages=false");
    expect(args).toContain("-dColorImageFilter=/DCTEncode");
    expect(args).toContain("-dPassThroughJPEGImages=false");
    expect(args).toContain("-dPassThroughJPXImages=false");
  });

  it("mantém JBIG2 lossless e nunca habilita substituição de símbolos", () => {
    expect(ocrMyPdfOptimizationLevel(options(), "MONOCHROME")).toBe(1);
    const args = buildOcrMyPdfOptimizerArgs({
      inputPath: "/tmp/in.pdf",
      outputPath: "/tmp/out.pdf",
      options: options(),
      colorMode: "MONOCHROME",
    });
    expect(args).toContain("--skip-text");
    expect(args).toContain("--tesseract-timeout");
    expect(args).toContain("0");
    expect(args).toContain("--output-type");
    expect(args).toContain("pdf");
    expect(args).not.toContain("--jbig2-lossy");
    expect(buildOcrMyPdfOptimizerArgs.toString()).not.toContain(
      "--jbig2-lossy",
    );
  });

  it("exige ganho maior para candidato visual/lossy", () => {
    const source = readFileSync(
      new URL("./compression.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("PDF_COMPRESSION_MIN_VISUAL_SAVINGS_RATIO");
    expect(source).toContain("?? 0.03");
    expect(source).toContain("candidate.lossy || candidate.visualTransform");
    expect(source).toContain("{ visualTransform: true, lossy: true }");
  });
});
