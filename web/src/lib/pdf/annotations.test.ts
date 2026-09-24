import { describe, expect, it } from "vitest";
import { degrees, PDFDocument } from "pdf-lib";
import { applyPdfAnnotations } from "@/lib/pdf/annotations";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
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
  it.each([0, 90, 180, 270])("keeps text upright, positioned and evenly spaced at %s degrees", async (rotation) => {
    const source = await PDFDocument.create();
    const page = source.addPage([500, 700]);
    page.setCropBox(30, 40, 420, 600);
    page.setRotation(degrees(rotation));
    const bytes = await applyPdfAnnotations({
      manifest,
      pdfBytes: await source.save(),
      annotations: [{
        id: "text-geometry", pageId: "page-1", type: "TEXT",
        text: "Primeira linha\nSegunda linha", color: "#123456", fontSize: 18,
        x: 0.2, y: 0.25,
      }],
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    const document = await loadingTask.promise;
    try {
      const result = await document.getPage(1);
      const viewport = result.getViewport({ scale: 1 });
      const content = await result.getTextContent();
      const items = content.items.filter((item) => "str" in item && item.str.trim());
      expect(items.map((item) => "str" in item ? item.str : "")).toEqual(["Primeira linha", "Segunda linha"]);
      const matrices = items.map((item) => {
        if (!("transform" in item)) throw new Error("Missing text geometry");
        return pdfjs.Util.transform(viewport.transform, item.transform);
      });
      for (const matrix of matrices) {
        expect(matrix[0]).toBeGreaterThan(0);
        expect(matrix[1]).toBeCloseTo(0, 5);
        expect(matrix[4]).toBeCloseTo(viewport.width * 0.2, 1);
      }
      expect(matrices[0][5]).toBeGreaterThan(viewport.height * 0.25);
      expect(matrices[0][5]).toBeLessThan(viewport.height * 0.25 + 18);
      expect(matrices[1][5] - matrices[0][5]).toBeCloseTo(18 * 1.15, 1);
    } finally {
      await loadingTask.destroy();
    }
  });
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

  it("preserves a rotated page and draws relative to its existing CropBox", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([500, 700]);
    page.setCropBox(30, 40, 420, 600);
    page.setRotation(degrees(90));

    const bytes = await applyPdfAnnotations({
      manifest,
      pdfBytes: await source.save(),
      annotations: [
        {
          id: "rectangle-rotated",
          pageId: "page-1",
          type: "RECTANGLE",
          color: "#123456",
          height: 0.2,
          opacity: 1,
          width: 0.3,
          x: 0.1,
          y: 0.15,
        },
        {
          id: "text-rotated",
          pageId: "page-1",
          type: "TEXT",
          color: "#123456",
          fontSize: 16,
          text: "Texto girado",
          x: 0.2,
          y: 0.25,
        },
      ],
    });
    const result = await PDFDocument.load(bytes);

    expect(result.getPage(0).getRotation().angle).toBe(90);
    expect(result.getPage(0).getCropBox()).toEqual({
      height: 600,
      width: 420,
      x: 30,
      y: 40,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
