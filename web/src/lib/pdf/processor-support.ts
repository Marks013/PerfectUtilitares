import {
  pdfAnnotationsSchema,
  pdfManifestSchema,
  type PdfManifest,
} from "@/lib/pdf/schema";
import { prisma } from "@/lib/prisma";

export const STRUCTURAL_OPERATIONS = new Set([
  "MERGE",
  "SPLIT",
  "ROTATE",
  "DELETE_PAGES",
  "EXTRACT_PAGES",
  "CROP",
  "ORGANIZE",
  "EDIT",
  "ANNOTATE",
  "PDF_TO_JPG",
]);

export const NON_STRUCTURAL_OPERATIONS = new Set([
  "COMPRESS",
  "JPG_TO_PDF",
  "PDF_TO_WORD",
  "PDF_TO_EXCEL",
  "WORD_TO_PDF",
  "EXCEL_TO_PDF",
]);

export class PdfProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PdfProcessingError";
  }
}

export function parseManifest(options: unknown): PdfManifest {
  const manifest =
    options && typeof options === "object" && "manifest" in options
      ? (options as { manifest: unknown }).manifest
      : null;
  const parsed = pdfManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    throw new PdfProcessingError(
      "INVALID_MANIFEST",
      "A organização salva não pôde ser processada.",
    );
  }

  return parsed.data;
}

export function requireFirstInput<T>(inputArtifacts: readonly T[]): T {
  const firstInput = inputArtifacts[0];

  if (firstInput === undefined) {
    throw new PdfProcessingError(
      "INPUT_REQUIRED",
      "Adicione ao menos um PDF antes de processar.",
    );
  }

  return firstInput;
}

export function requireStructuralManifest(
  manifest: PdfManifest | null,
): PdfManifest {
  if (!manifest) {
    throw new PdfProcessingError(
      "INVALID_MANIFEST",
      "A organização salva não pôde ser processada.",
    );
  }

  return manifest;
}

export function parseAnnotations(options: unknown) {
  const annotations =
    options && typeof options === "object" && "annotations" in options
      ? (options as { annotations: unknown }).annotations
      : [];
  const parsed = pdfAnnotationsSchema.safeParse(annotations);

  if (!parsed.success) {
    throw new PdfProcessingError(
      "INVALID_ANNOTATIONS",
      "As marcações salvas não puderam ser processadas.",
    );
  }

  return parsed.data;
}

export function createOutputName(inputName: string, operation: string) {
  const baseName = inputName.replace(/\.pdf$/i, "");
  const suffix =
    operation === "MERGE"
      ? "unido"
      : operation === "EXTRACT_PAGES"
        ? "extraido"
        : operation === "ROTATE"
          ? "girado"
      : operation === "DELETE_PAGES"
        ? "ajustado"
        : operation === "CROP"
          ? "recortado"
        : operation === "EDIT"
          ? "editado"
        : operation === "ANNOTATE"
          ? "anotado"
        : "organizado";
  return `${baseName || "documento"}-${suffix}.pdf`;
}

export function createSplitOutputName(inputName: string, pageNumber: number) {
  const baseName = inputName.replace(/\.pdf$/i, "") || "documento";
  return `${baseName}-pagina-${String(pageNumber).padStart(3, "0")}.pdf`;
}

export async function updateProgress(jobId: string, progress: number) {
  await prisma.pdfJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { progress: Math.max(1, Math.min(99, Math.round(progress))) },
  });
}

