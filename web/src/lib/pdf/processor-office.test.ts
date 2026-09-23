import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  export: vi.fn(), find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(),
  deleteMany: vi.fn(), transaction: vi.fn(), write: vi.fn(), remove: vi.fn(), capacity: vi.fn(), capture: vi.fn(),
  render: vi.fn(), writeImage: vi.fn(),
}));
vi.mock("@sentry/node", () => ({ captureException: mocks.capture }));
vi.mock("@/lib/pdf/annotations", () => ({ applyPdfAnnotations: vi.fn() }));
vi.mock("@/lib/pdf/capacity", () => ({ getPdfWorkingSetMultiplier: () => 2 }));
vi.mock("@/lib/pdf/compression", () => ({ compressPdfFile: vi.fn(), PdfToolError: class extends Error {} }));
vi.mock("@/lib/pdf/images-to-pdf", () => ({ buildPdfFromImages: vi.fn() }));
vi.mock("@/lib/pdf/office-export", () => ({ convertPdfToOffice: mocks.export }));
vi.mock("@/lib/pdf/render", () => ({ renderPdfPagesToJpeg: mocks.render, PdfRenderError: class extends Error {} }));
vi.mock("@/lib/pdf/structural", () => ({ buildStructuralPdf: vi.fn(), splitStructuralPdf: vi.fn(), PdfStructureError: class extends Error {} }));
vi.mock("@/lib/pdf/storage", () => ({
  writeOfficeOutput: mocks.write, removePdfStorageKey: mocks.remove,
  writeBinaryOutput: mocks.writeImage, writePdfOutput: vi.fn(),
}));
vi.mock("@/lib/system/resource-capacity", () => ({ assertResourceCapacity: mocks.capacity }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  pdfJob: { findUnique: mocks.find, update: mocks.update, updateMany: mocks.updateMany },
  pdfArtifact: { createMany: mocks.createMany, deleteMany: mocks.deleteMany },
} }));
import { PdfOfficeError } from "./office";
import { processPdfJob } from "./processor";
import type { PdfManifest } from "./schema";

function job(operation: string, count = 1) {
  return { id: "job-1", operation, options: {}, status: "QUEUED", inputBytes: BigInt(count * 200),
    artifacts: Array.from({ length: count }, (_, i) => ({
      id: `input-${i}`, kind: "INPUT", originalName: `Relatório ${i}.PDF`, sizeBytes: 200n,
      storageKey: `job-1/input-${i}.pdf`, createdAt: new Date(),
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.capacity.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockResolvedValue([]);
  mocks.remove.mockResolvedValue(undefined);
  mocks.export.mockImplementation(async ({ onProgress }: { onProgress: (n: number) => Promise<void> }) => {
    await onProgress(50);
    return new Uint8Array([80, 75, 1]);
  });
  mocks.write.mockImplementation(async (jobId: string, originalName: string, extension: string) => ({
    artifactId: `output-${originalName}`, originalName, sha256: "sha-test", sizeBytes: 3n,
    storageKey: `${jobId}/${originalName}.${extension}`,
  }));
});

describe("PDF Office export processor integration", () => {
  it.each(["a".repeat(176), `${"a".repeat(158)}😀${"b".repeat(16)}`])(
    "retains unique JPG page suffixes for long filenames",
    async (baseName) => {
      const manifest: PdfManifest = { version: 1, pages: [1, 2].map((sourcePage) => ({
        id: `page-${sourcePage}`, artifactId: "input-000", sourcePage, rotation: 0,
      })) };
      const inputJob = job("PDF_TO_JPG");
      inputJob.artifacts[0].id = "input-000";
      inputJob.artifacts[0].originalName = `${baseName}.pdf`;
      inputJob.options = { manifest };
      mocks.find.mockResolvedValue(inputJob);
      mocks.writeImage.mockImplementation(async (_jobId: string, name: string) => ({
        artifactId: name, originalName: name, storageKey: name, sizeBytes: 3n, sha256: "image-hash",
      }));
      mocks.render.mockImplementation(async ({ onOutput }: {
        onOutput: (page: PdfManifest["pages"][number], bytes: Uint8Array, index: number) => Promise<void>;
      }) => {
        for (const [index, page] of manifest.pages.entries()) {
          await onOutput(page, new Uint8Array([1, 2, 3]), index);
        }
      });

      await processPdfJob("job-1");

      const names = mocks.writeImage.mock.calls.map((call) => call[1] as string);
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
      for (const [index, name] of names.entries()) {
        expect(name).toMatch(new RegExp(`-pagina-00${index + 1}\\.jpg$`));
        expect(name.length).toBeLessThanOrEqual(174);
        expect(Buffer.from(name, "utf8").toString("utf8")).toBe(name);
      }
      expect(mocks.createMany).toHaveBeenCalledWith({ data: names.map((originalName) =>
        expect.objectContaining({ originalName, mimeType: "image/jpeg" })) });
    },
  );

  it.each([
    ["PDF_TO_WORD", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["PDF_TO_EXCEL", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("persists %s with correct filename, bytes and MIME", async (operation, extension, mimeType) => {
    mocks.find.mockResolvedValue(job(operation, 2));
    await processPdfJob("job-1");
    expect(mocks.capacity).toHaveBeenCalledWith({ inputBytes: 400, multiplier: 2 });
    expect(mocks.export).toHaveBeenCalledTimes(2);
    expect(mocks.export).toHaveBeenNthCalledWith(1, expect.objectContaining({
      jobId: "job-1", storageKey: "job-1/input-0.pdf", extension,
      timeoutMs: expect.any(Number),
    }));
    expect(mocks.write).toHaveBeenNthCalledWith(1, "job-1", `Relatório 0.${extension}`, extension, new Uint8Array([80, 75, 1]));
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [0, 1].map((i) => expect.objectContaining({
      jobId: "job-1", kind: "OUTPUT", originalName: `Relatório ${i}.${extension}`,
      mimeType, sha256: "sha-test", sizeBytes: 3n,
    })) });
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: "job-1" }, data: expect.objectContaining({
      status: "SUCCEEDED", progress: 100, outputBytes: 6n, errorCode: null, errorMessage: null,
    }) });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rolls back written output when a later document cannot be recognized", async () => {
    mocks.find.mockResolvedValue(job("PDF_TO_WORD", 2));
    const error = new PdfOfficeError("PDF_OFFICE_OCR_NO_TEXT", "Confira a nitidez do PDF.");
    mocks.export.mockResolvedValueOnce(new Uint8Array([80, 75])).mockRejectedValueOnce(error);
    await expect(processPdfJob("job-1")).rejects.toBe(error);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("job-1/Relatório 0.docx.docx");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: { notIn: ["CANCELLED", "EXPIRED"] } },
      data: expect.objectContaining({ status: "FAILED", errorCode: "PDF_OFFICE_OCR_NO_TEXT", errorMessage: "Confira a nitidez do PDF." }),
    });
  });

  it("removes every generated workbook when artifact persistence fails", async () => {
    mocks.find.mockResolvedValue(job("PDF_TO_EXCEL", 2));
    const error = new Error("Database unavailable");
    mocks.transaction.mockRejectedValueOnce(error);
    await expect(processPdfJob("job-1")).rejects.toBe(error);
    expect(mocks.remove.mock.calls).toEqual([["job-1/Relatório 0.xlsx.xlsx"], ["job-1/Relatório 1.xlsx.xlsx"]]);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
});
