// PERFECT_PDF_FULL32_V2_2
import { describe, expect, it } from "vitest";
import { planPdfCompression } from "./compression-planner";
import type { PdfCompressionProfile } from "./compression-analyzer";
import type { PdfCompressionOptions } from "./compression-types";

const profile: PdfCompressionProfile = {
  pageCount: 1,
  sampledPages: [1],
  contentKind: "SCANNED_OCR",
  colorMode: "GRAYSCALE",
  sourceDpi: 200,
  minimumDpi: 200,
  maximumDpi: 200,
  fullPageImageRatio: 1,
  imageCoverageRatio: 1,
  imageCount: 1,
  hasSelectableText: true,
  hasOcrLayer: true,
  predominantImageEncoding: "JPEG",
  bitsPerComponent: 8,
  alreadyOptimized: false,
  optimizationClass: "RECOMPRESSIBLE_JPEG",
};

function options(patch: Partial<PdfCompressionOptions> = {}): PdfCompressionOptions {
  return {
    quality: "CUSTOM",
    method: "AUTO",
    dpi: 150,
    colorMode: "KEEP_DETECTED",
    imageQuality: 72,
    monochromeThreshold: 160,
    preserveTextLayer: true,
    allowSemanticLoss: false,
    userOverrides: {
      method: false,
      dpi: false,
      colorMode: false,
      imageQuality: false,
      monochromeThreshold: false,
    },
    ...patch,
  };
}

describe("planPdfCompression full32", () => {
  it("mantém a tonalidade detectada", () => {
    expect(planPdfCompression(options(), profile).effectiveOptions.colorMode)
      .toBe("GRAYSCALE");
  });

  it("nunca rasteriza OCR em AUTO", () => {
    const plan = planPdfCompression(
      options({
        userOverrides: {
          method: false,
          dpi: true,
          colorMode: false,
          imageQuality: true,
          monochromeThreshold: false,
        },
      }),
      profile,
    );
    expect(plan.strategy).toBe("IMAGE_RECOMPRESSION");
  });

  it("RASTER explícito com preservação ativa não achata OCR/estrutura", () => {
    const plan = planPdfCompression(
      options({
        method: "RASTER",
        preserveTextLayer: true,
        allowSemanticLoss: false,
      }),
      profile,
    );
    expect(plan.strategy).toBe("IMAGE_RECOMPRESSION");
    expect(plan.preservesSemantics).toBe(true);
  });

  it("qualidade explícita participa da decisão", () => {
    const scan = { ...profile, contentKind: "SCANNED" as const, hasOcrLayer: false };
    const plan = planPdfCompression(
      options({
        imageQuality: 55,
        userOverrides: {
          method: false,
          dpi: false,
          colorMode: false,
          imageQuality: true,
          monochromeThreshold: false,
        },
      }),
      scan,
    );
    expect(plan.strategy).toBe("IMAGE_RECOMPRESSION");
    expect(plan.effectiveOptions.imageQuality).toBe(55);
  });

  it("AUTO considera ganho estimado em JPEG 200 -> 150 DPI", () => {
    const scan = {
      ...profile,
      contentKind: "SCANNED" as const,
      hasOcrLayer: false,
      sourceDpi: 200,
      minimumDpi: 200,
      maximumDpi: 200,
      predominantImageEncoding: "JPEG" as const,
    };
    const plan = planPdfCompression(options(), scan);
    expect(plan.strategy).toBe("IMAGE_RECOMPRESSION");
    expect(plan.expectedSavings).not.toBe("NONE");
  });

  it("MIXED usa recompressão preservadora quando há override visual", () => {
    const mixed = {
      ...profile,
      contentKind: "MIXED" as const,
      hasOcrLayer: false,
    };
    const plan = planPdfCompression(
      options({
        userOverrides: {
          method: false,
          dpi: true,
          colorMode: false,
          imageQuality: false,
          monochromeThreshold: false,
        },
      }),
      mixed,
    );
    expect(plan.strategy).toBe("IMAGE_RECOMPRESSION");
  });

  it("MIXED com imagens pesadas entra em recompressão preservadora", () => {
    const mixed = {
      ...profile,
      contentKind: "MIXED" as const,
      hasOcrLayer: false,
      optimizationClass: "MIXED_WITH_HEAVY_IMAGES" as const,
      sourceDpi: 150,
      minimumDpi: 150,
      maximumDpi: 150,
    };
    expect(planPdfCompression(options(), mixed).strategy).toBe(
      "IMAGE_RECOMPRESSION",
    );
  });

  it("scan JPEG/JPX já otimizado pode ser preservado sem override", () => {
    const optimized = {
      ...profile,
      contentKind: "SCANNED" as const,
      hasOcrLayer: false,
      alreadyOptimized: true,
      optimizationClass: "OPTIMIZED_JPEG" as const,
      sourceDpi: 150,
      minimumDpi: 150,
      maximumDpi: 150,
    };
    expect(planPdfCompression(options({ dpi: 150 }), optimized).strategy).toBe(
      "SKIP",
    );
  });

  it("não ignora override de cor", () => {
    const plan = planPdfCompression(
      options({
        colorMode: "MONOCHROME",
        userOverrides: {
          method: false,
          dpi: false,
          colorMode: true,
          imageQuality: false,
          monochromeThreshold: false,
        },
      }),
      profile,
    );
    expect(plan.effectiveOptions.colorMode).toBe("MONOCHROME");
  });
});
