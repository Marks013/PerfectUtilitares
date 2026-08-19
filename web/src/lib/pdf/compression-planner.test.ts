import { describe, expect, it } from "vitest";
import { planPdfCompression } from "@/lib/pdf/compression-planner";
import type { PdfCompressionProfile } from "@/lib/pdf/compression-analyzer";
import type { PdfCompressionOptions } from "@/lib/pdf/compression-types";

const options: PdfCompressionOptions = {
  quality: "BALANCED",
  method: "AUTO",
  dpi: 150,
  colorMode: "MONOCHROME",
  imageQuality: 80,
  monochromeThreshold: 160,
};

function profile(overrides: Partial<PdfCompressionProfile> = {}): PdfCompressionProfile {
  return {
    pageCount: 185,
    sampledPages: [1, 46, 93, 139, 185],
    contentKind: "SCANNED_OCR",
    colorMode: "MONOCHROME",
    sourceDpi: 200,
    minimumDpi: 200,
    maximumDpi: 200,
    fullPageImageRatio: 1,
    imageCoverageRatio: 1,
    imageCount: 185,
    hasSelectableText: true,
    hasOcrLayer: true,
    predominantImageEncoding: "JBIG2",
    bitsPerComponent: 1,
    alreadyOptimized: true,
    ...overrides,
  };
}

describe("PDF compression planner", () => {
  it("keeps explicit LOSSLESS structural", () => {
    expect(
      planPdfCompression({ ...options, method: "LOSSLESS" }, profile()),
    ).toMatchObject({ strategy: "STRUCTURAL", expectedSavings: "LOW" });
  });

  it("protects OCR from explicit RASTER", () => {
    expect(
      planPdfCompression({ ...options, method: "RASTER" }, profile()),
    ).toMatchObject({ strategy: "STRUCTURAL", expectedSavings: "LOW" });
  });

  it("uses conservative structural compression when analysis is unavailable", () => {
    expect(planPdfCompression(options, null)).toMatchObject({
      strategy: "STRUCTURAL",
      expectedSavings: "LOW",
    });
  });

  it("does not rasterize an OCR + JBIG2 + 200 DPI monochrome scan", () => {
    expect(planPdfCompression(options, profile())).toMatchObject({
      strategy: "SKIP",
      expectedSavings: "NONE",
    });
  });

  it("rasterizes oversized scans", () => {
    expect(
      planPdfCompression(
        { ...options, dpi: 150, colorMode: "COLOR" },
        profile({
          contentKind: "SCANNED",
          colorMode: "COLOR",
          sourceDpi: 600,
          maximumDpi: 600,
          predominantImageEncoding: "JPEG",
          bitsPerComponent: 8,
          alreadyOptimized: false,
          hasSelectableText: false,
          hasOcrLayer: false,
        }),
      ),
    ).toMatchObject({ strategy: "RASTER" });
  });

  it("rasterizes inefficient FLATE scans near the target DPI", () => {
    expect(
      planPdfCompression(
        options,
        profile({
          contentKind: "SCANNED",
          sourceDpi: 160,
          predominantImageEncoding: "FLATE",
          bitsPerComponent: 8,
          alreadyOptimized: false,
          hasSelectableText: false,
          hasOcrLayer: false,
        }),
      ),
    ).toMatchObject({ strategy: "RASTER" });
  });

  it("rasterizes JPEG scans meaningfully above the target DPI", () => {
    expect(
      planPdfCompression(
        options,
        profile({
          contentKind: "SCANNED",
          sourceDpi: 180,
          predominantImageEncoding: "JPEG",
          bitsPerComponent: 8,
          alreadyOptimized: false,
          hasSelectableText: false,
          hasOcrLayer: false,
        }),
      ),
    ).toMatchObject({ strategy: "RASTER" });
  });

  it("keeps efficient scans structural when rasterization has no clear benefit", () => {
    expect(
      planPdfCompression(
        options,
        profile({
          contentKind: "SCANNED",
          sourceDpi: 150,
          predominantImageEncoding: "JBIG2",
          alreadyOptimized: false,
          hasSelectableText: false,
          hasOcrLayer: false,
        }),
      ),
    ).toMatchObject({ strategy: "STRUCTURAL" });
  });

  it("keeps explicit RASTER for scans without OCR", () => {
    expect(
      planPdfCompression(
        { ...options, method: "RASTER" },
        profile({
          contentKind: "SCANNED",
          hasSelectableText: false,
          hasOcrLayer: false,
          alreadyOptimized: false,
          predominantImageEncoding: "JPEG",
          bitsPerComponent: 8,
        }),
      ),
    ).toMatchObject({ strategy: "RASTER", expectedSavings: "MEDIUM" });
  });

  it("does not recompress an already optimized scan just because SCREEN uses RASTER", () => {
    expect(
      planPdfCompression(
        {
          ...options,
          quality: "SCREEN",
          method: "RASTER",
          dpi: 96,
          imageQuality: 55,
        },
        profile({
          contentKind: "SCANNED",
          hasSelectableText: false,
          hasOcrLayer: false,
          alreadyOptimized: true,
          colorMode: "MONOCHROME",
          predominantImageEncoding: "JBIG2",
          bitsPerComponent: 1,
        }),
      ),
    ).toMatchObject({ strategy: "SKIP", expectedSavings: "NONE" });
  });

  it("preserves custom color mode for scans without OCR", () => {
    const plan = planPdfCompression(
      {
        ...options,
        quality: "CUSTOM",
        colorMode: "MONOCHROME",
      },
      profile({
        contentKind: "SCANNED",
        colorMode: "COLOR",
        hasSelectableText: false,
        hasOcrLayer: false,
        alreadyOptimized: false,
        predominantImageEncoding: "JPEG",
        bitsPerComponent: 8,
      }),
    );
    expect(plan.rasterOptions.colorMode).toBe("MONOCHROME");
  });

  it("uses detected color mode for presets", () => {
    const plan = planPdfCompression(
      { ...options, quality: "BALANCED", colorMode: "COLOR" },
      profile({
        contentKind: "SCANNED",
        colorMode: "GRAYSCALE",
        hasSelectableText: false,
        hasOcrLayer: false,
        alreadyOptimized: false,
        predominantImageEncoding: "JPEG",
        bitsPerComponent: 8,
      }),
    );
    expect(plan.rasterOptions.colorMode).toBe("GRAYSCALE");
  });

  it("keeps vector and mixed documents structural", () => {
    expect(
      planPdfCompression(
        options,
        profile({
          contentKind: "VECTOR",
          colorMode: "COLOR",
          sourceDpi: null,
          minimumDpi: null,
          maximumDpi: null,
          imageCount: 0,
          fullPageImageRatio: 0,
          imageCoverageRatio: 0,
          predominantImageEncoding: null,
          bitsPerComponent: null,
          alreadyOptimized: false,
        }),
      ),
    ).toMatchObject({ strategy: "STRUCTURAL" });

    expect(
      planPdfCompression(
        options,
        profile({ contentKind: "MIXED", alreadyOptimized: false }),
      ),
    ).toMatchObject({ strategy: "STRUCTURAL" });
  });
});
