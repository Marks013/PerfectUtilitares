import { describe, expect, it } from "vitest";
import {
  classifyRenderedColors,
  deriveCompressionRecommendation,
  type PdfCompressionAnalysis,
} from "@/lib/pdf/client-compression-analysis";

function pixels(red: number, green: number, blue: number) {
  const result = new Uint8ClampedArray(100 * 4);
  for (let offset = 0; offset < result.length; offset += 4) {
    result.set([red, green, blue, 255], offset);
  }
  return result;
}

function analysis(
  overrides: Partial<PdfCompressionAnalysis> = {},
): PdfCompressionAnalysis {
  return {
    fileKey: "documento.pdf-1",
    fileName: "documento.pdf",
    pageCount: 1,
    sampledPages: 1,
    contentKind: "SCANNED",
    colorMode: "COLOR",
    sourceDpi: 300,
    minimumDpi: 300,
    maximumDpi: 300,
    imageCount: 1,
    hasSelectableText: false,
    ...overrides,
  };
}

describe("PDF compression analysis", () => {
  it("classifies color, grayscale and monochrome samples", () => {
    expect(classifyRenderedColors(pixels(190, 30, 40))).toBe("COLOR");
    expect(classifyRenderedColors(pixels(128, 128, 128))).toBe("GRAYSCALE");
    expect(classifyRenderedColors(pixels(0, 0, 0))).toBe("MONOCHROME");
  });

  it("preserves vector documents without rasterizing", () => {
    expect(
      deriveCompressionRecommendation([
        analysis({
          contentKind: "VECTOR",
          imageCount: 0,
          hasSelectableText: true,
          sourceDpi: null,
          minimumDpi: null,
          maximumDpi: null,
        }),
      ]),
    ).toMatchObject({
      method: "LOSSLESS",
      dpi: 150,
      colorMode: "COLOR",
    });
  });

  it("uses the nearest supported DPI for scanned documents", () => {
    expect(
      deriveCompressionRecommendation([analysis({ sourceDpi: 287 })]),
    ).toMatchObject({
      method: "AUTO",
      dpi: 300,
      colorMode: "COLOR",
      imageQuality: 86,
    });
  });

  it("uses conservative batch settings when documents differ", () => {
    expect(
      deriveCompressionRecommendation([
        analysis({
          colorMode: "GRAYSCALE",
          sourceDpi: 96,
        }),
        analysis({
          colorMode: "COLOR",
          sourceDpi: 300,
        }),
      ]),
    ).toMatchObject({
      method: "AUTO",
      dpi: 200,
      colorMode: "COLOR",
    });
  });
});
