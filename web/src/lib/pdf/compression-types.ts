// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_ADAPTIVE_V4_2
export const PDF_COMPRESSION_PROTOCOL_REVISION =
  "perfect-pdf-adaptive-2026.08.20-v5.0";

export type PdfCompressionQuality =
  | "SOURCE"
  | "CUSTOM"
  | "SCREEN"
  | "BALANCED"
  | "PRINT";

export type PdfCompressionMethod = "AUTO" | "LOSSLESS" | "RASTER";
export type PdfCompressionColorMode = "COLOR" | "GRAYSCALE" | "MONOCHROME";
export type PdfCompressionColorPolicy =
  | "KEEP_DETECTED"
  | PdfCompressionColorMode;

export type PdfCompressionOverrides = {
  method: boolean;
  dpi: boolean;
  colorMode: boolean;
  imageQuality: boolean;
  monochromeThreshold: boolean;
};

export type PdfCompressionOptions = {
  quality: PdfCompressionQuality;
  method: PdfCompressionMethod;
  dpi: number;
  colorMode: PdfCompressionColorPolicy;
  imageQuality: number;
  monochromeThreshold: number;
  userOverrides: PdfCompressionOverrides;
  preserveTextLayer: boolean;
  allowSemanticLoss: boolean;
  sourceRevision?: string;
};

export type PdfCompressionEffectiveOptions = Omit<
  PdfCompressionOptions,
  "colorMode"
> & {
  colorMode: PdfCompressionColorMode;
};

export const NO_PDF_COMPRESSION_OVERRIDES: PdfCompressionOverrides = {
  method: false,
  dpi: false,
  colorMode: false,
  imageQuality: false,
  monochromeThreshold: false,
};

export class PdfToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    details?: string,
  ) {
    super(message, {
      cause: details ? new Error(details.slice(0, 4_000)) : undefined,
    });
    this.name = "PdfToolError";
  }
}
