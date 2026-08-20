// PERFECT_PDF_FULL32_V2_2
import type { PdfCompressionProfile } from "./compression-analyzer";
import type {
  PdfCompressionColorMode,
  PdfCompressionEffectiveOptions,
  PdfCompressionOptions,
} from "./compression-types";

type PdfCompressionStrategy =
  | "SKIP"
  | "STRUCTURAL"
  | "IMAGE_RECOMPRESSION"
  | "RASTER";

export type PdfCompressionPlan = {
  strategy: PdfCompressionStrategy;
  reason: string;
  expectedSavings: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  effectiveOptions: PdfCompressionEffectiveOptions;
  notApplied: string[];
  preservesSemantics: boolean;
};

function resolveColorMode(
  options: PdfCompressionOptions,
  profile: PdfCompressionProfile | null,
): PdfCompressionColorMode {
  if (options.colorMode !== "KEEP_DETECTED") return options.colorMode;
  return profile?.colorMode ?? "COLOR";
}

function effectiveOptions(
  options: PdfCompressionOptions,
  profile: PdfCompressionProfile | null,
): PdfCompressionEffectiveOptions {
  const sourceDpi = profile?.sourceDpi ?? options.dpi;
  return {
    ...options,
    dpi:
      options.method === "LOSSLESS"
        ? options.dpi
        : Math.max(72, Math.min(options.dpi, sourceDpi)),
    colorMode: resolveColorMode(options, profile),
  };
}

function hasVisualOverride(options: PdfCompressionOptions) {
  return (
    options.userOverrides.dpi ||
    options.userOverrides.colorMode ||
    options.userOverrides.imageQuality ||
    options.userOverrides.monochromeThreshold
  );
}

function estimatedImageOutputRatio(
  options: PdfCompressionEffectiveOptions,
  profile: PdfCompressionProfile,
) {
  const sourceDpi = profile.sourceDpi ?? options.dpi;
  const dpiRatio =
    sourceDpi > 0
      ? Math.min(1, Math.pow(options.dpi / sourceDpi, 2))
      : 1;

  const encodingRatio =
    profile.predominantImageEncoding === "FLATE" ||
    profile.predominantImageEncoding === "OTHER"
      ? 0.62
      : profile.predominantImageEncoding === "JPEG"
        ? options.userOverrides.imageQuality
          ? Math.min(1, Math.max(0.48, options.imageQuality / 88))
          : 1
        : profile.predominantImageEncoding === "JPX"
          ? options.userOverrides.imageQuality
            ? Math.min(1, Math.max(0.58, options.imageQuality / 92))
            : 1
          : 1;

  const colorRatio =
    options.colorMode === profile.colorMode
      ? 1
      : options.colorMode === "MONOCHROME"
        ? 0.18
        : options.colorMode === "GRAYSCALE" &&
            profile.colorMode === "COLOR"
          ? 0.42
          : 1;

  return Math.max(0.03, Math.min(1, dpiRatio * encodingRatio * colorRatio));
}

function expectedSavingsFromRatio(
  outputRatio: number,
): PdfCompressionPlan["expectedSavings"] {
  if (outputRatio <= 0.55) return "HIGH";
  if (outputRatio <= 0.82) return "MEDIUM";
  if (outputRatio <= 0.97) return "LOW";
  return "NONE";
}

export function planPdfCompression(
  options: PdfCompressionOptions,
  profile: PdfCompressionProfile | null,
): PdfCompressionPlan {
  const applied = effectiveOptions(options, profile);

  if (options.method === "LOSSLESS") {
    return {
      strategy: "STRUCTURAL",
      reason: "Compactação sem perdas solicitada explicitamente.",
      expectedSavings: "LOW",
      effectiveOptions: applied,
      notApplied: ["dpi", "colorMode", "imageQuality", "monochromeThreshold"],
      preservesSemantics: true,
    };
  }

  if (options.method === "RASTER") {
    if (options.preserveTextLayer && !options.allowSemanticLoss) {
      return {
        strategy: "IMAGE_RECOMPRESSION",
        reason: profile?.hasOcrLayer
          ? "O PDF possui OCR. A rasterização explícita foi convertida para recompressão preservadora."
          : "A preservação semântica está ativa; a recompressão visual será feita sem achatar estruturas documentais.",
        expectedSavings: "MEDIUM",
        effectiveOptions: applied,
        notApplied: [],
        preservesSemantics: true,
      };
    }
    return {
      strategy: "RASTER",
      reason:
        "Recompressão visual solicitada explicitamente; este caminho pode achatar estruturas semânticas.",
      expectedSavings: "MEDIUM",
      effectiveOptions: applied,
      notApplied: [],
      preservesSemantics: false,
    };
  }

  if (!profile) {
    return {
      strategy: "STRUCTURAL",
      reason: "Análise autoritativa indisponível; usando alternativa conservadora.",
      expectedSavings: "LOW",
      effectiveOptions: applied,
      notApplied: ["dpi", "colorMode", "imageQuality", "monochromeThreshold"],
      preservesSemantics: true,
    };
  }

  const sourceDpi = profile.sourceDpi ?? applied.dpi;
  const estimatedOutputRatio = estimatedImageOutputRatio(applied, profile);
  const estimatedSavings = expectedSavingsFromRatio(estimatedOutputRatio);
  const wantsDpiReduction =
    applied.dpi < sourceDpi &&
    (options.userOverrides.dpi ||
      sourceDpi - applied.dpi >= 30 ||
      estimatedOutputRatio <= 0.85);
  const wantsColorChange =
    options.colorMode !== "KEEP_DETECTED" &&
    options.colorMode !== profile.colorMode;
  const wantsQualityChange = options.userOverrides.imageQuality;
  const expensiveEncoding =
    profile.predominantImageEncoding === "FLATE" ||
    profile.predominantImageEncoding === "OTHER";
  const heavyMixedImages =
    profile.optimizationClass === "MIXED_WITH_HEAVY_IMAGES";
  const imageWorkRequested =
    wantsDpiReduction ||
    wantsColorChange ||
    wantsQualityChange ||
    options.userOverrides.monochromeThreshold ||
    expensiveEncoding ||
    heavyMixedImages ||
    estimatedOutputRatio <= 0.88;

  if (
    profile.alreadyOptimized &&
    !hasVisualOverride(options) &&
    !imageWorkRequested
  ) {
    return {
      strategy: "SKIP",
      reason: `O arquivo já está otimizado (${profile.optimizationClass}).`,
      expectedSavings: "NONE",
      effectiveOptions: applied,
      notApplied: [],
      preservesSemantics: true,
    };
  }

  if (profile.contentKind === "VECTOR" || profile.imageCount === 0) {
    return {
      strategy: "STRUCTURAL",
      reason: "Conteúdo textual/vetorial sem imagens relevantes deve manter sua estrutura.",
      expectedSavings: "LOW",
      effectiveOptions: applied,
      notApplied: ["dpi", "colorMode", "imageQuality", "monochromeThreshold"],
      preservesSemantics: true,
    };
  }

  if (
    profile.contentKind === "SCANNED_OCR" ||
    profile.contentKind === "MIXED"
  ) {
    return {
      strategy: imageWorkRequested ? "IMAGE_RECOMPRESSION" : "STRUCTURAL",
      reason:
        profile.contentKind === "SCANNED_OCR"
          ? "OCR detectado: AUTO nunca achata a página; imagens são recomprimidas preservando a camada textual."
          : "Conteúdo misto: imagens são tratadas sem destruir texto e vetores.",
      expectedSavings: imageWorkRequested ? estimatedSavings : "LOW",
      effectiveOptions: applied,
      notApplied: imageWorkRequested ? [] : ["dpi", "colorMode", "imageQuality", "monochromeThreshold"],
      preservesSemantics: true,
    };
  }

  // Scan sem OCR: raster é seguro no AUTO quando a página é essencialmente imagem.
  if (imageWorkRequested) {
    return {
      strategy: "IMAGE_RECOMPRESSION",
      reason: wantsDpiReduction
        ? `Scan em ${sourceDpi} DPI; alvo efetivo ${applied.dpi} DPI com recompressão preservadora.`
        : wantsColorChange
          ? "Scan com conversão de tonalidade preservando estruturas documentais."
          : wantsQualityChange
            ? `Scan com qualidade JPEG ${applied.imageQuality}% via recompressão preservadora.`
            : "Scan possui imagens com codificação recompressível; AUTO preserva estruturas documentais.",
      expectedSavings:
        estimatedSavings === "NONE" ? "LOW" : estimatedSavings,
      effectiveOptions: applied,
      notApplied: [],
      preservesSemantics: true,
    };
  }

  return {
    strategy: "STRUCTURAL",
    reason: "Scan já próximo do alvo; evitando recompressão visual sem benefício provável.",
    expectedSavings: "LOW",
    effectiveOptions: applied,
    notApplied: ["dpi", "colorMode", "imageQuality", "monochromeThreshold"],
    preservesSemantics: true,
  };
}
