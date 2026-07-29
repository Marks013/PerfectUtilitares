import { createCanvas } from "@napi-rs/canvas";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfManifest } from "@/lib/pdf/schema";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";
import { readPdfStorageFile } from "@/lib/pdf/storage";
import { PdfStructureError } from "@/lib/pdf/structural";

type RenderInput = {
  id: string;
  originalName: string;
  storageKey: string;
};

export async function renderPdfPagesToJpeg({
  inputs,
  manifest,
  onOutput,
  onProgress,
  quality = 82,
  dpi = 150,
}: {
  inputs: Map<string, RenderInput>;
  manifest: PdfManifest;
  quality?: number;
  dpi?: number;
  onOutput: (
    instruction: PdfManifest["pages"][number],
    bytes: Uint8Array,
    index: number,
  ) => Promise<void> | void;
  onProgress?: (progress: number) => Promise<void> | void;
}) {
  ensureServerLocalStorage();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documents = new Map<string, PDFDocumentProxy>();

  try {
    for (const [index, instruction] of manifest.pages.entries()) {
      const input = inputs.get(instruction.artifactId);
      if (!input) {
        throw new PdfStructureError(
          "INVALID_PAGE_SOURCE",
          "Uma página referencia um arquivo que não pertence ao trabalho.",
        );
      }

      let document = documents.get(input.id);
      if (!document) {
        try {
          document = await pdfjs.getDocument({
            data: new Uint8Array(
              await readPdfStorageFile(input.storageKey),
            ),
            useSystemFonts: true,
          }).promise;
        } catch {
          throw new PdfStructureError(
            "PDF_OPEN_FAILED",
            `Não foi possível abrir ${input.originalName}.`,
          );
        }
        documents.set(input.id, document);
      }

      if (instruction.sourcePage > document.numPages) {
        throw new PdfStructureError(
          "PAGE_NOT_FOUND",
          `A página ${instruction.sourcePage} não existe em ${input.originalName}.`,
        );
      }

      const page = await document.getPage(instruction.sourcePage);
      const viewport = page.getViewport({
        rotation: (page.rotate + instruction.rotation) % 360,
        scale: dpi / 72,
      });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const bytes = canvas.toBuffer("image/jpeg", quality);
      await onOutput(instruction, bytes, index);
      page.cleanup();
      await onProgress?.(10 + ((index + 1) / manifest.pages.length) * 80);
    }
  } finally {
    await Promise.all(
      [...documents.values()].map((document) => document.cleanup()),
    );
  }
}
