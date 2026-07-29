import { describe, expect, it } from "vitest";
import {
  pdfCompressionOptionsSchema,
  pdfJobCreateSchema,
  pdfJobUpdateSchema,
  pdfManifestSchema,
} from "@/lib/pdf/schema";

describe("pdf schemas", () => {
  const page = {
    id: "page-1",
    artifactId: "artifact-123",
    sourcePage: 1,
    rotation: 90,
  };

  it("accepts a supported operation", () => {
    expect(
      pdfJobCreateSchema.parse({ operation: "ORGANIZE" }),
    ).toMatchObject({ operation: "ORGANIZE" });
  });

  it("rejects unknown operations", () => {
    expect(
      pdfJobCreateSchema.safeParse({ operation: "EXECUTE_COMMAND" }).success,
    ).toBe(false);
  });

  it("accepts a versioned page manifest", () => {
    const parsed = pdfJobUpdateSchema.parse({
      manifest: { version: 1, pages: [page] },
    });
    expect(parsed).toMatchObject({
      annotations: [],
      manifest: { version: 1, pages: [page] },
    });
  });

  it("accepts normalized editor annotations", () => {
    expect(
      pdfJobUpdateSchema.safeParse({
        manifest: { version: 1, pages: [page] },
        annotations: [
          {
            id: "annotation-1",
            pageId: page.id,
            type: "HIGHLIGHT",
            color: "#FACC15",
            height: 0.1,
            opacity: 0.35,
            width: 0.5,
            x: 0.1,
            y: 0.2,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects annotations outside the page", () => {
    expect(
      pdfJobUpdateSchema.safeParse({
        manifest: { version: 1, pages: [page] },
        annotations: [
          {
            id: "annotation-1",
            pageId: page.id,
            type: "RECTANGLE",
            color: "#2563EB",
            height: 0.2,
            opacity: 1,
            width: 0.4,
            x: 0.8,
            y: 0.2,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects arbitrary rotations and empty documents", () => {
    expect(
      pdfManifestSchema.safeParse({
        version: 1,
        pages: [{ ...page, rotation: 45 }],
      }).success,
    ).toBe(false);
    expect(
      pdfManifestSchema.safeParse({ version: 1, pages: [] }).success,
    ).toBe(false);
  });

  it("expands compact compression defaults", () => {
    expect(
      pdfCompressionOptionsSchema.parse({ quality: "SCREEN" }),
    ).toEqual({
      quality: "SCREEN",
      method: "RASTER",
      dpi: 96,
      colorMode: "COLOR",
      imageQuality: 55,
      monochromeThreshold: 160,
    });
  });

  it("accepts advanced compression settings", () => {
    expect(
      pdfCompressionOptionsSchema.parse({
        quality: "BALANCED",
        method: "RASTER",
        dpi: 120,
        colorMode: "MONOCHROME",
        imageQuality: 68,
        monochromeThreshold: 176,
      }),
    ).toMatchObject({
      method: "RASTER",
      dpi: 120,
      colorMode: "MONOCHROME",
      monochromeThreshold: 176,
    });
  });

  it("rejects unsafe compression limits", () => {
    expect(
      pdfCompressionOptionsSchema.safeParse({
        method: "RASTER",
        dpi: 600,
        colorMode: "COLOR",
        imageQuality: 10,
      }).success,
    ).toBe(false);
  });
});
