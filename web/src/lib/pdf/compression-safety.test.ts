import { describe, expect, it } from "vitest";
import { hasRequiredPdfSavings } from "./compression-image-recompression";
import { planPdfCompression } from "./compression-planner";
import { pdfCompressionOptionsSchema } from "./schema";

describe("compression safety boundaries", () => {
  it.each([
    { preserveTextLayer: true, allowSemanticLoss: false },
    { preserveTextLayer: false, allowSemanticLoss: false },
    { preserveTextLayer: true, allowSemanticLoss: true },
  ])("requires explicit consent and disabled preservation for flattening: %o", (flags) => {
    const options = pdfCompressionOptionsSchema.parse({ method: "RASTER", ...flags });
    expect(planPdfCompression(options, null)).toMatchObject({
      strategy: "IMAGE_RECOMPRESSION",
      preservesSemantics: true,
    });
  });

  it("retains deliberate rasterization with explicit consent", () => {
    const options = pdfCompressionOptionsSchema.parse({
      method: "RASTER", preserveTextLayer: false, allowSemanticLoss: true,
    });
    expect(planPdfCompression(options, null)).toMatchObject({
      strategy: "RASTER", preservesSemantics: false,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "never selects an empty or invalid candidate size: %s", (size) => {
      expect(hasRequiredPdfSavings(10_000, size, 0.03)).toBe(false);
    },
  );

  it("retains positive candidates with real savings", () => {
    expect(hasRequiredPdfSavings(10_000, 8_000, 0.03)).toBe(true);
    expect(hasRequiredPdfSavings(10_000, 10_000, 0.03)).toBe(false);
  });
});
