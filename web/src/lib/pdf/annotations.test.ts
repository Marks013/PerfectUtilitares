import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyPdfAnnotations } from "@/lib/pdf/annotations";
import type { PdfManifest } from "@/lib/pdf/schema";

async function createPdf() {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return document.save();
}

const manifest: PdfManifest = {
  version: 1,
  pages: [
    {
      id: "page-1",
      artifactId: "artifact-0001",
      sourcePage: 1,
      rotation: 0,
    },
  ],
};

describe("applyPdfAnnotations", () => {
  it("keeps page geometry while applying supported annotations", async () => {
    const bytes = await applyPdfAnnotations({
      manifest,
      pdfBytes: await createPdf(),
      annotations: [
        {
          id: "text-1",
          pageId: "page-1",
          type: "TEXT",
          color: "#123456",
          fontSize: 18,
          text: "Observação",
          x: 0.1,
          y: 0.1,
        },
        {
          id: "highlight-1",
          pageId: "page-1",
          type: "HIGHLIGHT",
          color: "#facc15",
          height: 0.08,
          opacity: 0.3,
          width: 0.5,
          x: 0.2,
          y: 0.25,
        },
        {
          id: "draw-1",
          pageId: "page-1",
          type: "DRAW",
          color: "#2563eb",
          opacity: 1,
          points: [
            { x: 0.1, y: 0.8 },
            { x: 0.6, y: 0.7 },
          ],
          width: 3,
        },
      ],
    });

    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(1);
    expect(result.getPage(0).getSize()).toEqual({ height: 600, width: 400 });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
