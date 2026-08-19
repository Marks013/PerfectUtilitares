import type { PdfCompressionOptions } from "./compression-types";
import type { PdfCompressionProfile } from "./compression-analyzer";

type PdfCompressionStrategy = "SKIP" | "STRUCTURAL" | "RASTER";

export type PdfCompressionPlan = {
  strategy: PdfCompressionStrategy;
  reason: string;
  expectedSavings: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  rasterOptions: PdfCompressionOptions;
};

function effectiveRasterOptions(
  options: PdfCompressionOptions,
  profile: PdfCompressionProfile,
) {
  const isCustom = options.quality === "CUSTOM";
  const sourceDpi = profile.sourceDpi ?? options.dpi;
  const targetDpi = Math.max(72, Math.min(options.dpi, sourceDpi));

  return {
    ...options,
    dpi: isCustom ? options.dpi : targetDpi,
    colorMode: isCustom ? options.colorMode : profile.colorMode,
  };
}

function hasSemanticContent(profile: PdfCompressionProfile) {
  return (
    profile.contentKind === "VECTOR" ||
    profile.contentKind === "MIXED" ||
    profile.contentKind === "SCANNED_OCR" ||
    profile.hasSelectableText ||
    profile.hasOcrLayer
  );
}

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

  if (!profile) {
    return {
      strategy: "STRUCTURAL",
      reason:
        "Análise autoritativa indisponível; usando a alternativa conservadora.",
      expectedSavings: "LOW",
      rasterOptions: options,
    };
  }

  const isCustom = options.quality === "CUSTOM";
  const effective = effectiveRasterOptions(options, profile);

  if (options.method === "RASTER") {
    if (hasSemanticContent(profile)) {
      return {
        strategy: "STRUCTURAL",
        reason:
          "Texto, vetores ou OCR detectados; a rasterização foi bloqueada para preservar a estrutura do documento.",
        expectedSavings: "LOW",
        rasterOptions: effective,
      };
    }

    if (profile.alreadyOptimized && !isCustom) {
      return {
        strategy: "SKIP",
        reason:
          "Scan já otimizado em JBIG2/CCITT; o preset não força uma recompressão que possa aumentar o arquivo.",
        expectedSavings: "NONE",
        rasterOptions: effective,
      };
    }

    return {
      strategy: "RASTER",
      reason: "Recompressão visual solicitada explicitamente para scan sem OCR.",
      expectedSavings: "MEDIUM",
      rasterOptions: effective,
    };
  }

  if (profile.alreadyOptimized && !isCustom) {
    return {
      strategy: "SKIP",
      reason:
        "Scan monocromático em JBIG2/CCITT e resolução adequada; já otimizado.",
      expectedSavings: "NONE",
      rasterOptions: effective,
    };
  }

  if (profile.contentKind === "VECTOR") {
    return {
      strategy: "STRUCTURAL",
      reason: "Conteúdo vetorial/textual deve preservar sua estrutura original.",
      expectedSavings: "LOW",
      rasterOptions: effective,
    };
  }

  if (profile.contentKind === "MIXED") {
    return {
      strategy: "STRUCTURAL",
      reason:
        "PDF misto preservado estruturalmente; ajustes visuais não são aplicados sem achatar texto/vetores.",
      expectedSavings: "LOW",
      rasterOptions: effective,
    };
  }

  if (profile.contentKind === "SCANNED_OCR" || profile.hasOcrLayer) {
    return {
      strategy: "STRUCTURAL",
      reason:
        "PDF digitalizado com OCR preservado estruturalmente; a página não será achatada.",
      expectedSavings: "LOW",
      rasterOptions: effective,
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

  if (oversized || expensiveEncoding || jpegCanShrink || isCustom) {
    return {
      strategy: "RASTER",
      reason: isCustom
        ? "Configuração visual personalizada solicitada pelo usuário."
        : oversized
          ? `Scan em ${sourceDpi} DPI acima do alvo de ${targetDpi} DPI.`
          : expensiveEncoding
            ? "Imagens de página inteira usam codificação pouco eficiente."
            : "Scan JPEG pode ser reduzido para a resolução selecionada.",
      expectedSavings: oversized ? "HIGH" : "MEDIUM",
      rasterOptions: effective,
    };
  }

  return {
    strategy: "STRUCTURAL",
    reason:
      "O conteúdo digitalizado já está próximo da resolução alvo; evitando rasterização desnecessária.",
    expectedSavings: "LOW",
    rasterOptions: effective,
  };
}
