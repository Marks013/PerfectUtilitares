import type { PdfCompressionOptions } from "./compression-types";
import type { PdfCompressionProfile } from "./compression-analyzer";

type PdfCompressionStrategy = "SKIP" | "STRUCTURAL" | "RASTER";
export type PdfCompressionPlan = {
  strategy: PdfCompressionStrategy;
  reason: string;
  expectedSavings: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  rasterOptions: PdfCompressionOptions;
};

export function planPdfCompression(
  options: PdfCompressionOptions,
  profile: PdfCompressionProfile | null,
): PdfCompressionPlan {
  if (options.method === "LOSSLESS") {
    return {
      strategy: "STRUCTURAL",
      reason: "Compactação sem perdas solicitada explicitamente.",
      expectedSavings: "LOW",
      rasterOptions: options,
    };
  }
  if (options.method === "RASTER") {
    return {
      strategy: "RASTER",
      reason: "Recompressão visual solicitada explicitamente.",
      expectedSavings: "MEDIUM",
      rasterOptions: options,
    };
  }
  if (!profile) {
    return {
      strategy: "STRUCTURAL",
      reason: "Análise indisponível; usando a alternativa conservadora.",
      expectedSavings: "LOW",
      rasterOptions: options,
    };
  }
  if (profile.alreadyOptimized) {
    return {
      strategy: "SKIP",
      reason: "Scan monocromático em JBIG2/CCITT e resolução adequada; já otimizado.",
      expectedSavings: "NONE",
      rasterOptions: options,
    };
  }
  if (profile.contentKind === "VECTOR") {
    return {
      strategy: "STRUCTURAL",
      reason: "Conteúdo vetorial/textual deve preservar sua estrutura original.",
      expectedSavings: "LOW",
      rasterOptions: options,
    };
  }
  if (profile.contentKind === "MIXED") {
    return {
      strategy: "STRUCTURAL",
      reason: "PDF misto usa compactação estrutural para preservar texto e vetores.",
      expectedSavings: "LOW",
      rasterOptions: options,
    };
  }
  const sourceDpi = profile.sourceDpi ?? options.dpi;
  const targetDpi = Math.max(72, Math.min(options.dpi, sourceDpi));
  const expensiveEncoding =
    profile.predominantImageEncoding === "FLATE" ||
    profile.predominantImageEncoding === "OTHER";
  const oversized = sourceDpi >= Math.max(240, targetDpi + 40);
  const jpegCanShrink =
    profile.predominantImageEncoding === "JPEG" && sourceDpi > targetDpi + 20;
  if (oversized || expensiveEncoding || jpegCanShrink) {
    return {
      strategy: "RASTER",
      reason: oversized
        ? `Scan em ${sourceDpi} DPI acima do alvo de ${targetDpi} DPI.`
        : expensiveEncoding
          ? "Imagens de página inteira usam codificação pouco eficiente."
          : "Scan JPEG pode ser reduzido para a resolução selecionada.",
      expectedSavings: oversized ? "HIGH" : "MEDIUM",
      rasterOptions: {
        ...options,
        dpi: targetDpi,
        colorMode: profile.colorMode,
      },
    };
  }
  return {
    strategy: "STRUCTURAL",
    reason: "O conteúdo digitalizado já está próximo da resolução alvo; evitando rasterização desnecessária.",
    expectedSavings: "LOW",
    rasterOptions: options,
  };
}
