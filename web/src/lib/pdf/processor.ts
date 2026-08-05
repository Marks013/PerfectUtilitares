import * as Sentry from "@sentry/node";
import { applyPdfAnnotations } from "@/lib/pdf/annotations";
import { getPdfWorkingSetMultiplier } from "@/lib/pdf/capacity";
import { compressPdfFile, PdfToolError } from "@/lib/pdf/compression";
import { buildPdfFromImages } from "@/lib/pdf/images-to-pdf";
import {
  convertOfficeToPdf,
  PdfOfficeError,
} from "@/lib/pdf/office";
import {
  jpgToPdfOptionsSchema,
  pdfAnnotationsSchema,
  pdfCompressionOptionsSchema,
  pdfManifestSchema,
  pdfToJpgOptionsSchema,
  type PdfManifest,
} from "@/lib/pdf/schema";
import {
  removePdfStorageKey,
  writeBinaryOutput,
  writePdfOutput,
} from "@/lib/pdf/storage";
import { PdfRenderError, renderPdfPagesToJpeg } from "@/lib/pdf/render";
import {
  buildStructuralPdf,
  PdfStructureError,
  splitStructuralPdf,
} from "@/lib/pdf/structural";
import { prisma } from "@/lib/prisma";
import { assertResourceCapacity } from "@/lib/system/resource-capacity";

const STRUCTURAL_OPERATIONS = new Set([
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

const NON_STRUCTURAL_OPERATIONS = new Set([
  "COMPRESS",
  "JPG_TO_PDF",
  "PDF_TO_WORD",
  "PDF_TO_EXCEL",
  "WORD_TO_PDF",
  "EXCEL_TO_PDF",
]);

class PdfProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PdfProcessingError";
  }
}

function parseManifest(options: unknown): PdfManifest {
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

function parseAnnotations(options: unknown) {
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

function createOutputName(inputName: string, operation: string) {
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

function createSplitOutputName(inputName: string, pageNumber: number) {
  const baseName = inputName.replace(/\.pdf$/i, "") || "documento";
  return `${baseName}-pagina-${String(pageNumber).padStart(3, "0")}.pdf`;
}

async function updateProgress(jobId: string, progress: number) {
  await prisma.pdfJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { progress: Math.max(1, Math.min(99, Math.round(progress))) },
  });
}

export async function processPdfJob(jobId: string) {
  const job = await prisma.pdfJob.findUnique({
    where: { id: jobId },
    include: {
      artifacts: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!job || job.status === "CANCELLED" || job.status === "EXPIRED") {
    return;
  }

  const isStructuralOperation = STRUCTURAL_OPERATIONS.has(job.operation);
  if (!isStructuralOperation && !NON_STRUCTURAL_OPERATIONS.has(job.operation)) {
    throw new PdfProcessingError(
      "OPERATION_NOT_READY",
      "Esta ferramenta ainda não possui um processador disponível.",
    );
  }

  const manifest = isStructuralOperation ? parseManifest(job.options) : null;
  const inputArtifacts = job.artifacts.filter(
    (artifact) => artifact.kind === "INPUT",
  );
  const artifactsById = new Map(
    inputArtifacts.map((artifact) => [artifact.id, artifact]),
  );

  if (!inputArtifacts.length) {
    throw new PdfProcessingError(
      "INPUT_REQUIRED",
      "Adicione ao menos um PDF antes de processar.",
    );
  }

  const invalidReference = manifest?.pages.some(
    (page) => !artifactsById.has(page.artifactId),
  );
  if (invalidReference) {
    throw new PdfProcessingError(
      "INVALID_PAGE_SOURCE",
      "Uma página referencia um arquivo que não pertence ao trabalho.",
    );
  }

  await assertResourceCapacity({
    inputBytes: Number(job.inputBytes),
    multiplier: getPdfWorkingSetMultiplier(job.operation),
  });

  await prisma.pdfJob.update({
    where: { id: job.id },
    data: {
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      progress: 1,
      startedAt: new Date(),
      status: "RUNNING",
    },
  });

  const priorOutputs = job.artifacts.filter(
    (artifact) => artifact.kind === "OUTPUT",
  );
  if (priorOutputs.length) {
    await prisma.pdfArtifact.deleteMany({
      where: { id: { in: priorOutputs.map((artifact) => artifact.id) } },
    });
    await Promise.all(
      priorOutputs.map((artifact) =>
        removePdfStorageKey(artifact.storageKey).catch(() => undefined),
      ),
    );
  }

  const writtenStorageKeys: string[] = [];

  try {
    if (job.operation === "COMPRESS") {
      const options = pdfCompressionOptionsSchema.parse(job.options ?? {});
      const outputs: Array<Awaited<ReturnType<typeof compressPdfFile>>> = [];

      for (const [index, input] of inputArtifacts.entries()) {
        const baseName = input.originalName.replace(/\.pdf$/i, "");
        const output = await compressPdfFile({
          inputStorageKey: input.storageKey,
          jobId: job.id,
          onProgress: (progress) =>
            updateProgress(
              job.id,
              5 +
                ((index + progress / 100) / inputArtifacts.length) * 85,
            ),
          options,
          outputName: `${baseName || "documento"}-comprimido.pdf`,
        });
        outputs.push(output);
        writtenStorageKeys.push(output.storageKey);
      }

      const totalBytes = outputs.reduce(
        (total, output) => total + output.sizeBytes,
        BigInt(0),
      );
      await prisma.$transaction([
        prisma.pdfArtifact.createMany({
          data: outputs.map((output) => ({
            id: output.artifactId,
            jobId: job.id,
            kind: "OUTPUT",
            mimeType: "application/pdf",
            originalName: output.originalName,
            sha256: output.sha256,
            sizeBytes: output.sizeBytes,
            storageKey: output.storageKey,
          })),
        }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            outputBytes: totalBytes,
            progress: 100,
            status: "SUCCEEDED",
          },
        }),
      ]);
      return;
    }

    if (job.operation === "JPG_TO_PDF") {
      const options = jpgToPdfOptionsSchema.parse(job.options ?? {});
      const outputBytes = await buildPdfFromImages({
        inputs: inputArtifacts,
        margin: options.margin,
        pageSize: options.pageSize,
        onProgress: (progress) => updateProgress(job.id, progress),
      });
      const firstInput = inputArtifacts[0]!;
      const output = await writePdfOutput(
        job.id,
        `${firstInput.originalName.replace(/\.(?:jpe?g|png|webp)$/i, "") || "imagens"}.pdf`,
        outputBytes,
      );
      writtenStorageKeys.push(output.storageKey);

      await prisma.$transaction([
        prisma.pdfArtifact.create({
          data: {
            id: output.artifactId,
            jobId: job.id,
            kind: "OUTPUT",
            mimeType: "application/pdf",
            originalName: output.originalName,
            pageCount: inputArtifacts.length,
            sha256: output.sha256,
            sizeBytes: output.sizeBytes,
            storageKey: output.storageKey,
          },
        }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            outputBytes: output.sizeBytes,
            progress: 100,
            status: "SUCCEEDED",
          },
        }),
      ]);
      return;
    }

    if (
      job.operation === "PDF_TO_WORD" ||
      job.operation === "PDF_TO_EXCEL"
    ) {
      throw new PdfProcessingError(
        "PDF_OFFICE_EXPORT_DISABLED",
        "PDF para Word/Excel foi desativado porque não preservava layout, imagens e tabelas com fidelidade.",
      );
    }

    if (
      job.operation === "WORD_TO_PDF" ||
      job.operation === "EXCEL_TO_PDF"
    ) {
      const outputs: Array<{
        artifactId: string;
        mimeType: string;
        originalName: string;
        sha256: string;
        sizeBytes: bigint;
        storageKey: string;
      }> = [];

      for (const [index, input] of inputArtifacts.entries()) {
        const baseName =
          input.originalName.replace(/\.(?:pdf|docx|xlsx)$/i, "") ||
          "documento";
        const bytes = await convertOfficeToPdf({
          jobId: job.id,
          storageKey: input.storageKey,
        });
        const output = await writePdfOutput(
          job.id,
          `${baseName}.pdf`,
          bytes,
        );
        outputs.push({ ...output, mimeType: "application/pdf" });
        writtenStorageKeys.push(output.storageKey);
        await updateProgress(
          job.id,
          5 + ((index + 1) / inputArtifacts.length) * 85,
        );
      }

      const totalBytes = outputs.reduce(
        (total, output) => total + output.sizeBytes,
        BigInt(0),
      );
      await prisma.$transaction([
        prisma.pdfArtifact.createMany({
          data: outputs.map((output) => ({
            id: output.artifactId,
            jobId: job.id,
            kind: "OUTPUT",
            mimeType: output.mimeType,
            originalName: output.originalName,
            sha256: output.sha256,
            sizeBytes: output.sizeBytes,
            storageKey: output.storageKey,
          })),
        }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            outputBytes: totalBytes,
            progress: 100,
            status: "SUCCEEDED",
          },
        }),
      ]);
      return;
    }

    if (job.operation === "PDF_TO_JPG") {
      const options = pdfToJpgOptionsSchema.parse(job.options ?? {});
      const outputs: Array<Awaited<ReturnType<typeof writeBinaryOutput>>> = [];
      const firstInput = inputArtifacts[0]!;
      const baseName =
        firstInput.originalName.replace(/\.pdf$/i, "") || "documento";

      await renderPdfPagesToJpeg({
        dpi: options.dpi,
        inputs: artifactsById,
        manifest: manifest!,
        quality: options.quality,
        onProgress: (progress) => updateProgress(job.id, progress),
        async onOutput(_instruction, bytes, outputIndex) {
          const output = await writeBinaryOutput(
            job.id,
            `${baseName}-pagina-${String(outputIndex + 1).padStart(3, "0")}.jpg`,
            "jpg",
            bytes,
          );
          outputs[outputIndex] = output;
          writtenStorageKeys.push(output.storageKey);
        },
      });

      const totalBytes = outputs.reduce(
        (total, output) => total + output.sizeBytes,
        BigInt(0),
      );
      await prisma.$transaction([
        prisma.pdfArtifact.createMany({
          data: outputs.map((output) => ({
            id: output.artifactId,
            jobId: job.id,
            kind: "OUTPUT",
            mimeType: "image/jpeg",
            originalName: output.originalName,
            pageCount: 1,
            sha256: output.sha256,
            sizeBytes: output.sizeBytes,
            storageKey: output.storageKey,
          })),
        }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            outputBytes: totalBytes,
            progress: 100,
            status: "SUCCEEDED",
          },
        }),
      ]);
      return;
    }

    if (job.operation === "SPLIT") {
      const outputs: Array<Awaited<ReturnType<typeof writePdfOutput>>> = [];
      const firstInput = inputArtifacts[0]!;

      await splitStructuralPdf({
        inputs: artifactsById,
        manifest: manifest!,
        onProgress: (progress) => updateProgress(job.id, progress),
        async onOutput(_instruction, bytes, outputIndex) {
          const output = await writePdfOutput(
            job.id,
            createSplitOutputName(firstInput.originalName, outputIndex + 1),
            bytes,
          );
          writtenStorageKeys.push(output.storageKey);
          outputs[outputIndex] = output;
        },
      });

      const totalBytes = outputs.reduce(
        (total, output) => total + output.sizeBytes,
        BigInt(0),
      );
      await prisma.$transaction([
        prisma.pdfArtifact.createMany({
          data: outputs.map((output) => ({
            id: output.artifactId,
            jobId: job.id,
            kind: "OUTPUT",
            mimeType: "application/pdf",
            originalName: output.originalName,
            pageCount: 1,
            sha256: output.sha256,
            sizeBytes: output.sizeBytes,
            storageKey: output.storageKey,
          })),
        }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            outputBytes: totalBytes,
            progress: 100,
            status: "SUCCEEDED",
          },
        }),
      ]);
      return;
    }

    const structuralBytes = await buildStructuralPdf({
      inputs: artifactsById,
      manifest: manifest!,
      onProgress: (progress) => updateProgress(job.id, progress),
    });
    const outputBytes =
      job.operation === "EDIT" || job.operation === "ANNOTATE"
        ? await applyPdfAnnotations({
            annotations: parseAnnotations(job.options),
            manifest: manifest!,
            pdfBytes: structuralBytes,
          })
        : structuralBytes;
    const firstInput = inputArtifacts[0]!;
    const output = await writePdfOutput(
      job.id,
      createOutputName(firstInput.originalName, job.operation),
      outputBytes,
    );
    writtenStorageKeys.push(output.storageKey);

    await prisma.$transaction([
      prisma.pdfArtifact.create({
        data: {
          id: output.artifactId,
          jobId: job.id,
          kind: "OUTPUT",
          mimeType: "application/pdf",
          originalName: output.originalName,
          pageCount: manifest!.pages.length,
          sha256: output.sha256,
          sizeBytes: output.sizeBytes,
          storageKey: output.storageKey,
        },
      }),
      prisma.pdfJob.update({
        where: { id: job.id },
        data: {
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          outputBytes: output.sizeBytes,
          progress: 100,
          status: "SUCCEEDED",
        },
      }),
    ]);
  } catch (error) {
    await Promise.all(
      writtenStorageKeys.map((storageKey) =>
        removePdfStorageKey(storageKey).catch(() => undefined),
      ),
    );
    const code =
      error instanceof PdfProcessingError ||
      error instanceof PdfStructureError ||
      error instanceof PdfOfficeError ||
      error instanceof PdfToolError ||
      error instanceof PdfRenderError
        ? error.code
        : "PDF_PROCESSING_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível concluir o processamento do PDF.";

    await prisma.pdfJob.updateMany({
      where: { id: job.id, status: { notIn: ["CANCELLED", "EXPIRED"] } },
      data: {
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message,
        status: "FAILED",
      },
    });
    Sentry.captureException(error, {
      tags: { pdfJobId: job.id, pdfOperation: job.operation },
    });
    throw error;
  }
}
