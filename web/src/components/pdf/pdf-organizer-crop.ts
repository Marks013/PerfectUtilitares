import type { PDFDocumentProxy } from "pdfjs-dist";
import { combinePageRotation, displayMarginsToSource } from "@/lib/pdf/geometry";
import type { WorkspacePage } from "./pdf-organizer-workspace-model";

export async function cropWorkspacePages(
  pages: WorkspacePage[],
  ids: Set<string>,
  margins: NonNullable<WorkspacePage["cropMargins"]>,
  documents: Map<string, PDFDocumentProxy>,
) {
  if (!ids.size) throw new Error("Selecione ao menos uma página para aplicar o recorte.");
  return Promise.all(pages.map(async (page) => {
    if (!ids.has(page.id)) return page;
    const document = documents.get(page.artifactId);
    if (!document) throw new Error(`A página de “${page.fileName}” não está disponível.`);
    const source = await document.getPage(page.sourcePage);
    const sourceMargins = displayMarginsToSource(
      combinePageRotation(source.rotate, page.rotation), margins,
    );
    const sourceWidth = source.view[2] - source.view[0];
    const sourceHeight = source.view[3] - source.view[1];
    const width = sourceWidth * (1 - (sourceMargins.left + sourceMargins.right) / 100);
    const height = sourceHeight * (1 - (sourceMargins.top + sourceMargins.bottom) / 100);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("A área mantida precisa ter largura e altura maiores que zero.");
    }
    return {
      ...page,
      crop: { x: sourceWidth * sourceMargins.left / 100,
        y: sourceHeight * sourceMargins.bottom / 100, width, height },
      cropMargins: { ...margins },
    };
  }));
}
