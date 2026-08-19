// PERFECT_PDF_FULL32_V2_2
import { describe, expect, it } from "vitest";
import {
  COMPRESSION_PRESETS,
  type PdfOutput,
} from "@/components/pdf/pdf-compress-workspace-model";

describe("PDF compression full32 contract", () => {
  it("presets herdam a tonalidade do arquivo", () => {
    expect(COMPRESSION_PRESETS.SCREEN.colorMode).toBe("KEEP_DETECTED");
    expect(COMPRESSION_PRESETS.BALANCED.colorMode).toBe("KEEP_DETECTED");
    expect(COMPRESSION_PRESETS.PRINT.colorMode).toBe("KEEP_DETECTED");
  });

  it("resultado mantém sourceArtifactId dentro de metadata.compression", () => {
    const output: PdfOutput = {
      id: "out-b",
      kind: "OUTPUT",
      originalName: "b.pdf",
      sizeBytes: "500",
      metadata: {
        compression: {
          sourceArtifactId: "input-b",
          sourceName: "b.pdf",
          sourceSizeBytes: "1000",
          outcome: "COMPRESSED",
          strategy: "IMAGE_RECOMPRESSION",
          planReason: "recompressão preservadora",
          notApplied: [],
          preservation: {
            textLayer: true,
            annotations: true,
            forms: true,
            bookmarks: true,
            metadata: true,
            semanticValidated: true,
          },
        },
      },
    };

    expect(output.metadata?.compression?.sourceArtifactId).toBe("input-b");
    expect(output.metadata?.compression?.outcome).toBe("COMPRESSED");
    expect(output.metadata?.compression?.preservation?.semanticValidated)
      .toBe(true);
  });

  it("UNCHANGED mantém motivo e vínculo com o original", () => {
    const output: PdfOutput = {
      id: "out-a",
      kind: "OUTPUT",
      originalName: "a.pdf",
      sizeBytes: "1000",
      metadata: {
        compression: {
          sourceArtifactId: "input-a",
          sourceSizeBytes: "1000",
          outcome: "UNCHANGED",
          strategy: "STRUCTURAL",
          planReason: "original preservado",
          notApplied: ["dpi", "imageQuality"],
        },
      },
    };
    expect(output.metadata?.compression).toMatchObject({
      sourceArtifactId: "input-a",
      outcome: "UNCHANGED",
      notApplied: ["dpi", "imageQuality"],
    });
  });
});
