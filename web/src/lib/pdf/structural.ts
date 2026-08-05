import { degrees, PDFDocument, type PDFPage } from "pdf-lib";
import type { PdfManifest } from "@/lib/pdf/schema";
import { readPdfStorageFile } from "@/lib/pdf/storage";

type StructuralInput = {
  id: string;
  originalName: string;
  storageKey: string;
};

type BuildStructuralPdfOptions = {
  inputs: Map<string, StructuralInput>;
  manifest: PdfManifest;
  onProgress?: (progress: number) => Promise<void> | void;
};

type SplitStructuralPdfOptions = BuildStructuralPdfOptions & {
  onOutput: (
    instruction: PdfManifest["pages"][number],
    bytes: Uint8Array,
    outputIndex: number,
  ) => Promise<void> | void;
};

export class PdfStructureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PdfStructureError";
  }
}

function applyPageChanges(
  page: PDFPage,
  instruction: PdfManifest["pages"][number],
) {
  const currentRotation = page.getRotation().angle;
  page.setRotation(degrees((currentRotation + instruction.rotation) % 360));

  if (!instruction.crop) return;

  const visibleBox = page.getCropBox();
  const crop = instruction.crop;
  if (
    crop.x + crop.width > visibleBox.width + 0.001 ||
    crop.y + crop.height > visibleBox.height + 0.001
  ) {
    throw new PdfStructureError(
      "INVALID_CROP",
      "Uma área de recorte ultrapassa os limites da página.",
    );
  }

  page.setCropBox(
    visibleBox.x + crop.x,
    visibleBox.y + crop.y,
    crop.width,
    crop.height,
  );
}

export async function buildStructuralPdf({
  inputs,
  manifest,
  onProgress,
}: BuildStructuralPdfOptions) {
  const outputDocument = await PDFDocument.create();
  const copiedPages = new Map<string, PDFPage>();
  const pagesByArtifact = new Map<string, PdfManifest["pages"]>();

  for (const instruction of manifest.pages) {
    const existing = pagesByArtifact.get(instruction.artifactId) ?? [];
    existing.push(instruction);
    pagesByArtifact.set(instruction.artifactId, existing);
  }

  let completedSources = 0;
  for (const [artifactId, instructions] of pagesByArtifact) {
    const artifact = inputs.get(artifactId);
    if (!artifact) {
      throw new PdfStructureError(
        "INVALID_PAGE_SOURCE",
        "Uma página referencia um arquivo que não pertence ao trabalho.",
      );
    }

    const sourceBytes = await readPdfStorageFile(artifact.storageKey);
    let sourceDocument: PDFDocument;

    try {
      sourceDocument = await PDFDocument.load(sourceBytes);
    } catch {
      throw new PdfStructureError(
        "PDF_OPEN_FAILED",
        `Não foi possível abrir ${artifact.originalName}. Verifique se o arquivo possui senha ou está corrompido.`,
      );
    }

    const invalidPage = instructions.find(
      (instruction) => instruction.sourcePage > sourceDocument.getPageCount(),
    );
    if (invalidPage) {
      throw new PdfStructureError(
        "PAGE_NOT_FOUND",
        `A página ${invalidPage.sourcePage} não existe em ${artifact.originalName}.`,
      );
    }

    const sourceIndexes = instructions.map(
      (instruction) => instruction.sourcePage - 1,
    );
    const pages = await outputDocument.copyPages(
      sourceDocument,
      sourceIndexes,
    );

    pages.forEach((page, index) => {
      const instruction = instructions[index]!;
      applyPageChanges(page, instruction);
      copiedPages.set(instruction.id, page);
    });

    completedSources += 1;
    await onProgress?.(
      10 + (completedSources / pagesByArtifact.size) * 70,
    );
  }

  for (const instruction of manifest.pages) {
    const page = copiedPages.get(instruction.id);
    if (!page) {
      throw new PdfStructureError(
        "PAGE_COPY_FAILED",
        "Uma das páginas não pôde ser adicionada ao documento final.",
      );
    }
    outputDocument.addPage(page);
  }

  await onProgress?.(88);
  return outputDocument.save({
    addDefaultPage: false,
    useObjectStreams: true,
  });
}

export async function splitStructuralPdf({
  inputs,
  manifest,
  onOutput,
  onProgress,
}: SplitStructuralPdfOptions) {
  const instructionsByArtifact = new Map<string, PdfManifest["pages"]>();

  for (const instruction of manifest.pages) {
    const existing =
      instructionsByArtifact.get(instruction.artifactId) ?? [];
    existing.push(instruction);
    instructionsByArtifact.set(instruction.artifactId, existing);
  }

  const outputIndexById = new Map(
    manifest.pages.map((instruction, index) => [instruction.id, index]),
  );
  let completedPages = 0;

  for (const [artifactId, instructions] of instructionsByArtifact) {
    const artifact = inputs.get(artifactId);
    if (!artifact) {
      throw new PdfStructureError(
        "INVALID_PAGE_SOURCE",
        "Uma página referencia um arquivo que não pertence ao trabalho.",
      );
    }

    let sourceDocument: PDFDocument;
    try {
      sourceDocument = await PDFDocument.load(
        await readPdfStorageFile(artifact.storageKey),
      );
    } catch {
      throw new PdfStructureError(
        "PDF_OPEN_FAILED",
        `Não foi possível abrir ${artifact.originalName}. Verifique se o arquivo possui senha ou está corrompido.`,
      );
    }

    for (const instruction of instructions) {
      if (instruction.sourcePage > sourceDocument.getPageCount()) {
        throw new PdfStructureError(
          "PAGE_NOT_FOUND",
          `A página ${instruction.sourcePage} não existe em ${artifact.originalName}.`,
        );
      }

      const outputDocument = await PDFDocument.create();
      const [page] = await outputDocument.copyPages(sourceDocument, [
        instruction.sourcePage - 1,
      ]);
      applyPageChanges(page!, instruction);
      outputDocument.addPage(page!);
      const bytes = await outputDocument.save({
        addDefaultPage: false,
        useObjectStreams: true,
      });
      const outputIndex = outputIndexById.get(instruction.id)!;
      await onOutput(instruction, bytes, outputIndex);

      completedPages += 1;
      await onProgress?.(
        10 + (completedPages / manifest.pages.length) * 78,
      );
    }
  }
}
