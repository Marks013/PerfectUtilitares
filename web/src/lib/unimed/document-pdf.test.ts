import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  deleteMany: vi.fn(),
  enqueue: vi.fn(),
  findFirst: vi.fn(),
  generate: vi.fn(),
  loadPdf: vi.fn(),
  readFile: vi.fn(),
  removeJobFiles: vi.fn(),
  reserve: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  artifactCreate: vi.fn(),
  writeOfficeUpload: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));

vi.mock("pdf-lib", () => ({
  PDFDocument: { load: mocks.loadPdf },
}));

vi.mock("@/lib/pdf/capacity", () => ({
  createPdfDraftWithCapacity: mocks.createDraft,
  reservePdfJobForQueue: mocks.reserve,
}));

vi.mock("@/lib/pdf/constants", () => ({
  getPdfJobExpiry: vi.fn(() => new Date("2026-08-03T20:00:00Z")),
}));

vi.mock("@/lib/pdf/queue", () => ({ enqueuePdfJob: mocks.enqueue }));

vi.mock("@/lib/pdf/storage", () => ({
  removePdfJobFiles: mocks.removeJobFiles,
  resolvePdfStorageKey: (key: string) => `/data/pdf-jobs/${key}`,
  writeOfficeUpload: mocks.writeOfficeUpload,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfArtifact: { create: mocks.artifactCreate },
    pdfJob: {
      deleteMany: mocks.deleteMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/unimed/documents", () => ({
  generateUnimedDocument: mocks.generate,
}));

import {
  getUnimedDocumentPdf,
  queueUnimedDocumentPdf,
  UnimedDocumentPdfError,
} from "@/lib/unimed/document-pdf";

const tenantId = "tenant-test-123";
const moduleSessionId = "module-session-test-123";
const jobId = "pdf-job-test-123";
const documentPrincipal = `unimed-document:${tenantId}:${moduleSessionId}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({
    bytes: new TextEncoder().encode("PK synthetic docx"),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "unimed-rn561.docx",
    kind: "RN561",
  });
  mocks.createDraft.mockResolvedValue({ id: jobId });
  mocks.writeOfficeUpload.mockResolvedValue({
    artifactId: "input-artifact-123",
    sha256: "docx-digest",
    sizeBytes: 17n,
    storageKey: `${jobId}/input/input-artifact-123.docx`,
  });
  mocks.artifactCreate.mockResolvedValue({ id: "input-artifact-123" });
  mocks.update.mockResolvedValue({ id: jobId });
  mocks.transaction.mockImplementation((operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  );
  mocks.reserve.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue("queue-message-123");
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.removeJobFiles.mockResolvedValue(undefined);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.loadPdf.mockResolvedValue({ getPageCount: () => 1 });
});

describe("Unimed document PDF orchestration", () => {
  it("queues the in-memory DOCX as a tenant-scoped authenticated PDF job", async () => {
    const result = await queueUnimedDocumentPdf({
      beneficiaryId: "beneficiary-test-123",
      documentKind: "RN561",
      moduleSessionId,
      tenantId,
    });

    expect(result).toEqual({ id: jobId, progress: 0, status: "QUEUED" });
    expect(mocks.generate).toHaveBeenCalledWith(
      tenantId,
      "beneficiary-test-123",
      "RN561",
    );
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        operation: "WORD_TO_PDF",
        ownerSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        principalKey: documentPrincipal,
        tenantId,
        userId: null,
      }),
    );
    expect(mocks.writeOfficeUpload).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      jobId,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mocks.reserve).toHaveBeenCalledWith({
      isAuthenticated: true,
      jobId,
      principalKey: documentPrincipal,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(jobId, {
      key: documentPrincipal,
      tier: "authenticated",
    });
  });

  it("fails safely and removes staged data when the queue is unavailable", async () => {
    mocks.enqueue.mockRejectedValue(new Error("pg-boss unavailable"));
    mocks.findFirst.mockResolvedValue({ progress: 0, status: "QUEUED" });

    await expect(
      queueUnimedDocumentPdf({
        beneficiaryId: "beneficiary-test-123",
        documentKind: "RN561",
        moduleSessionId,
        tenantId,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UnimedDocumentPdfError>>({
        code: "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE",
        status: 503,
      }),
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(mocks.removeJobFiles).toHaveBeenCalledWith(jobId);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: jobId,
        principalKey: documentPrincipal,
        tenantId,
      },
    });
  });

  it("returns only tenant-scoped pending jobs", async () => {
    mocks.findFirst.mockResolvedValue({
      artifacts: [],
      expiresAt: new Date("2099-08-03T20:00:00Z"),
      id: jobId,
      progress: 42,
      status: "RUNNING",
    });

    const result = await getUnimedDocumentPdf(
      tenantId,
      moduleSessionId,
      jobId,
    );

    expect(result).toEqual({
      state: "PENDING",
      job: { id: jobId, progress: 42, status: "RUNNING" },
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: jobId,
          principalKey: documentPrincipal,
          tenantId,
        }),
      }),
    );
  });

  it("removes queued documents that expire without a worker", async () => {
    mocks.findFirst.mockResolvedValue({
      artifacts: [],
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      id: jobId,
      progress: 0,
      status: "QUEUED",
    });

    await expect(
      getUnimedDocumentPdf(tenantId, moduleSessionId, jobId),
    ).resolves.toEqual({
      state: "GONE",
    });
    expect(mocks.removeJobFiles).toHaveBeenCalledWith(jobId);
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("validates, returns and immediately removes a successful PDF", async () => {
    const bytes = new TextEncoder().encode("%PDF-valid-output");
    const sha256 = await crypto.subtle.digest("SHA-256", bytes);
    const digest = Array.from(new Uint8Array(sha256))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    mocks.findFirst.mockResolvedValue({
      artifacts: [
        {
          mimeType: "application/pdf",
          originalName: "unimed-rn561.pdf",
          sha256: digest,
          sizeBytes: BigInt(bytes.length),
          storageKey: `${jobId}/output/output-artifact-123.pdf`,
        },
      ],
      expiresAt: new Date("2099-08-03T20:00:00Z"),
      id: jobId,
      progress: 100,
      status: "SUCCEEDED",
    });
    mocks.readFile.mockResolvedValue(Buffer.from(bytes));

    const result = await getUnimedDocumentPdf(
      tenantId,
      moduleSessionId,
      jobId,
    );

    expect(result).toEqual({
      state: "READY",
      bytes,
      cleanupDeferred: false,
      contentType: "application/pdf",
      fileName: "unimed-rn561.pdf",
    });
    expect(mocks.loadPdf).toHaveBeenCalledWith(bytes, {
      updateMetadata: false,
    });
    expect(mocks.removeJobFiles).toHaveBeenCalledWith(jobId);
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
  });

  it("never returns a corrupt output or the original DOCX as fallback", async () => {
    mocks.findFirst.mockResolvedValue({
      artifacts: [
        {
          mimeType: "application/pdf",
          originalName: "unimed-rn561.pdf",
          sha256: "wrong-digest",
          sizeBytes: 12n,
          storageKey: `${jobId}/output/output-artifact-123.pdf`,
        },
      ],
      expiresAt: new Date("2099-08-03T20:00:00Z"),
      id: jobId,
      progress: 100,
      status: "SUCCEEDED",
    });
    mocks.readFile.mockResolvedValue(Buffer.from("PK fake docx"));

    await expect(
      getUnimedDocumentPdf(tenantId, moduleSessionId, jobId),
    ).resolves.toEqual({
      state: "FAILED",
    });
    expect(mocks.removeJobFiles).toHaveBeenCalledWith(jobId);
    expect(mocks.loadPdf).not.toHaveBeenCalled();
  });
});
