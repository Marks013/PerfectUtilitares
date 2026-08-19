// PERFECT_PDF_FULL32_V2_2
import type {
  PdfCompressionColorPolicy,
  PdfCompressionMethod,
  PdfCompressionQuality,
} from "./compression-types";

export type PdfCompressionPreset = {
  method: PdfCompressionMethod;
  dpi: number;
  colorMode: PdfCompressionColorPolicy;
  imageQuality: number;
  monochromeThreshold: number;
};

/**
 * Política única compartilhada por UI e schema.
 * Presets definem intensidade, nunca forçam a tonalidade do documento.
 */
export const PDF_COMPRESSION_PRESETS: Record<
  Exclude<PdfCompressionQuality, "SOURCE" | "CUSTOM">,
  PdfCompressionPreset
> = {
  SCREEN: {
    method: "AUTO",
    dpi: 96,
    colorMode: "KEEP_DETECTED",
    imageQuality: 55,
    monochromeThreshold: 160,
  },
  BALANCED: {
    method: "AUTO",
    dpi: 150,
    colorMode: "KEEP_DETECTED",
    imageQuality: 72,
    monochromeThreshold: 160,
  },
  PRINT: {
    method: "AUTO",
    dpi: 220,
    colorMode: "KEEP_DETECTED",
    imageQuality: 86,
    monochromeThreshold: 160,
  },
};

export const DEFAULT_PDF_COMPRESSION_PRESET = PDF_COMPRESSION_PRESETS.BALANCED;
