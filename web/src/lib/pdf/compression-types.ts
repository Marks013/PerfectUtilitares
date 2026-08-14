type PdfCompressionQuality =
  | "SOURCE"
  | "CUSTOM"
  | "SCREEN"
  | "BALANCED"
  | "PRINT";
type PdfCompressionMethod = "AUTO" | "LOSSLESS" | "RASTER";
export type PdfCompressionColorMode = "COLOR" | "GRAYSCALE" | "MONOCHROME";

export type PdfCompressionOptions = {
  quality: PdfCompressionQuality;
  method: PdfCompressionMethod;
  dpi: number;
  colorMode: PdfCompressionColorMode;
  imageQuality: number;
  monochromeThreshold: number;
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
