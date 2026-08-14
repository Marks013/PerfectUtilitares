import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyAnnotations: vi.fn(),
  artifactCreate: vi.fn(),
  artifactCreateMany: vi.fn(),
  artifactDeleteMany: vi.fn(),
  assertCapacity: vi.fn(),
  buildImages: vi.fn(),
  buildStructural: vi.fn(),
  captureException: vi.fn(),
  compress: vi.fn(),
  convertOffice: vi.fn(),
  findUnique: vi.fn(),
  jobUpdate: vi.fn(),
  jobUpdateMany: vi.fn(),
  removeStorage: vi.fn(),
  renderJpeg: vi.fn(),
  splitStructural: vi.fn(),
  transaction: vi.fn(),
  workingSetMultiplier: vi.fn(),
  writeBinary: vi.fn(),
  writePdf: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: mocks.captureException,
}));

vi.mock("@/lib/pdf/annotations", () => ({
  applyPdfAnnotations: mocks.applyAnnotations,
}));

vi.mock("@/lib/pdf/capacity", () => ({
  getPdfWorkingSetMultiplier: mocks.workingSetMultiplier,
}));

vi.mock("@/lib/pdf/compression", () => ({
  compressPdfFile: mocks.compress,
  PdfToolError: class PdfToolError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PdfToolError";
    }
  },
}));

vi.mock("@/lib/pdf/images-to-pdf", () => ({
  buildPdfFromImages: mocks.buildImages,
}));

vi.mock("@/lib/pdf/office", () => ({
  convertOfficeToPdf: mocks.convertOffice,
  PdfOfficeError: class PdfOfficeError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PdfOfficeError";
    }
  },
}));

vi.mock("@/lib/pdf/render", () => ({
  renderPdfPagesToJpeg: mocks.renderJpeg,
  PdfRenderError: class PdfRenderError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PdfRenderError";
    }
  },
}));

vi.mock("@/lib/pdf/storage", () => ({
  removePdfStorageKey: mocks.removeStorage,
  writeBinaryOutput: mocks.writeBinary,
  writePdfOutput: mocks.writePdf,
}));

vi.mock("@/lib/pdf/structural", () => ({
  buildStructuralPdf: mocks.buildStructural,
  splitStructuralPdf: mocks.splitStructural,
  PdfStructureError: class PdfStructureError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PdfStructureError";
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfArtifact: {
      create: mocks.artifactCreate,
      createMany: mocks.artifactCreateMany,
      deleteMany: mocks.artifactDeleteMany,
    },
    pdfJob: {
      findUnique: mocks.findUnique,
      update: mocks.jobUpdate,
      updateMany: mocks.jobUpdateMany,
    },
  },
}));

vi.mock("@/lib/system/resource-capacity", () => ({
  assertResourceCapacity: mocks.assertCapacity,
}));

import { PdfToolError } from "@/lib/pdf/compression";
import { processPdfJob } from "@/lib/pdf/processor";

function inputArtifact(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-08-07T12:00:00Z"),
    id: "input-1",
    kind: "INPUT",
    originalName: "arquivo.pdf",
    storageKey: "jobs/job-1/input.pdf",
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    artifacts: [inputArtifact()],
    id: "job-1",
    inputBytes: 200n,
    operation: "COMPRESS",
    options: {},
    status: "QUEUED",
    ...overrides,
  };
}

const compressedOutput = {
  artifactId: "output-1",
  originalName: "arquivo-comprimido.pdf",
  sha256: "abc123",
  sizeBytes: 40n,
  storageKey: "jobs/job-1/output.pdf",
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.workingSetMultiplier.mockReturnValue(2);
  mocks.assertCapacity.mockResolvedValue(undefined);
  mocks.jobUpdate.mockResolvedValue({});
  mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.artifactDeleteMany.mockResolvedValue({ count: 1 });
  mocks.artifactCreate.mockReturnValue({ operation: "create" });
  mocks.artifactCreateMany.mockReturnValue({ operation: "createMany" });
  mocks.transaction.mockResolvedValue([]);
  mocks.removeStorage.mockResolvedValue(undefined);
});

describe("PDF processor lifecycle", () => {
  it("ignores a job that no longer exists", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    await expect(processPdfJob("job-1")).resolves.toBeUndefined();

    expect(mocks.assertCapacity).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "EXPIRED"] as const)(
    "ignores a job already marked %s",
    async (status) => {
      mocks.findUnique.mockResolvedValueOnce(makeJob({ status }));

      await expect(processPdfJob("job-1")).resolves.toBeUndefined();

      expect(mocks.assertCapacity).not.toHaveBeenCalled();
      expect(mocks.jobUpdate).not.toHaveBeenCalled();
    },
  );

  it("rejects an operation without an available processor", async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeJob({ operation: "NOT_IMPLEMENTED" }),
    );

    await expect(processPdfJob("job-1")).rejects.toMatchObject({
      code: "OPERATION_NOT_READY",
    });

    expect(mocks.assertCapacity).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("rejects a job without input artifacts", async () => {
    mocks.findUnique.mockResolvedValueOnce(makeJob({ artifacts: [] }));

    await expect(processPdfJob("job-1")).rejects.toMatchObject({
      code: "INPUT_REQUIRED",
    });

    expect(mocks.assertCapacity).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).not.toHaveBeenCalled();
  });

  it("compresses the input, replaces stale outputs and marks success", async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        artifacts: [
          inputArtifact(),
          {
            createdAt: new Date("2026-08-07T11:00:00Z"),
            id: "old-output",
            kind: "OUTPUT",
            originalName: "antigo.pdf",
            storageKey: "jobs/job-1/old-output.pdf",
          },
        ],
      }),
    );
    mocks.compress.mockResolvedValueOnce(compressedOutput);

    await processPdfJob("job-1");

    expect(mocks.assertCapacity).toHaveBeenCalledWith({
      inputBytes: 200,
      multiplier: 2,
    });
    expect(mocks.artifactDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-output"] } },
    });
    expect(mocks.removeStorage).toHaveBeenCalledWith(
      "jobs/job-1/old-output.pdf",
    );

    expect(mocks.compress).toHaveBeenCalledWith(
      expect.objectContaining({
        inputStorageKey: "jobs/job-1/input.pdf",
        jobId: "job-1",
        outputName: "arquivo-comprimido.pdf",
      }),
    );

    expect(mocks.artifactCreateMany).toHaveBeenCalledWith({
      data: [
        {
          id: "output-1",
          jobId: "job-1",
          kind: "OUTPUT",
          mimeType: "application/pdf",
          originalName: "arquivo-comprimido.pdf",
          sha256: "abc123",
          sizeBytes: 40n,
          storageKey: "jobs/job-1/output.pdf",
        },
      ],
    });

    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        errorCode: null,
        errorMessage: null,
        outputBytes: 40n,
        progress: 100,
        status: "SUCCEEDED",
      }),
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });


  it("keeps successful outputs when one file in a compression batch fails", async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        artifacts: [
          inputArtifact({ id: "input-1", originalName: "ok.pdf" }),
          inputArtifact({ id: "input-2", originalName: "falha.pdf", storageKey: "jobs/job-1/input-2.pdf" }),
        ],
      }),
    );
    mocks.compress
      .mockResolvedValueOnce(compressedOutput)
      .mockRejectedValueOnce(new PdfToolError("QPDF_FAILED", "qpdf falhou"));

    await expect(processPdfJob("job-1")).resolves.toBeUndefined();

    expect(mocks.artifactCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: "output-1", kind: "OUTPUT" })],
    });
    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        errorCode: "PDF_COMPRESSION_PARTIAL",
        status: "SUCCEEDED",
      }),
    });
  });
  it("preserves a known processing error code and marks the job failed", async () => {
    const error = new PdfToolError("QPDF_FAILED", "qpdf falhou");

    mocks.findUnique.mockResolvedValueOnce(makeJob());
    mocks.compress.mockRejectedValueOnce(error);

    await expect(processPdfJob("job-1")).rejects.toBe(error);

    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: { notIn: ["CANCELLED", "EXPIRED"] },
      },
      data: expect.objectContaining({
        errorCode: "QPDF_FAILED",
        errorMessage: "qpdf falhou",
        status: "FAILED",
      }),
    });
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: {
        pdfJobId: "job-1",
        pdfOperation: "COMPRESS",
      },
    });
  });

  it("removes a newly written output when persistence fails", async () => {
    const error = new Error("database unavailable");

    mocks.findUnique.mockResolvedValueOnce(makeJob());
    mocks.compress.mockResolvedValueOnce(compressedOutput);
    mocks.transaction.mockRejectedValueOnce(error);

    await expect(processPdfJob("job-1")).rejects.toBe(error);

    expect(mocks.removeStorage).toHaveBeenCalledWith(
      "jobs/job-1/output.pdf",
    );
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: { notIn: ["CANCELLED", "EXPIRED"] },
      },
      data: expect.objectContaining({
        errorCode: "PDF_PROCESSING_FAILED",
        errorMessage: "database unavailable",
        status: "FAILED",
      }),
    });
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: {
        pdfJobId: "job-1",
        pdfOperation: "COMPRESS",
      },
    });
  });
});

const manifestFor = (artifactId = "input-123") => ({
  version: 1 as const,
  pages: [
    {
      id: "page-1",
      artifactId,
      sourcePage: 1,
      rotation: 0 as const,
    },
  ],
});

const generatedOutput = (
  artifactId: string,
  originalName: string,
  storageKey: string,
  sizeBytes: bigint,
) => ({
  artifactId,
  originalName,
  sha256: `${artifactId}-sha256`,
  sizeBytes,
  storageKey,
});

describe("PDF processor operation paths", () => {
  it("rejects a structural manifest that references another artifact", async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        operation: "MERGE",
        artifacts: [
          inputArtifact({
            id: "input-123",
          }),
        ],
        options: {
          manifest: manifestFor("missing-1"),
        },
      }),
    );

    await expect(processPdfJob("job-1")).rejects.toMatchObject({
      code: "INVALID_PAGE_SOURCE",
    });

    expect(mocks.assertCapacity).not.toHaveBeenCalled();
    expect(mocks.buildStructural).not.toHaveBeenCalled();
  });

  it("builds a PDF from images and persists one output", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const output = generatedOutput(
      "jpg-output",
      "foto.pdf",
      "jobs/job-1/foto.pdf",
      30n,
    );

    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        operation: "JPG_TO_PDF",
        artifacts: [
          inputArtifact({
            id: "image-123",
            originalName: "foto.jpg",
            storageKey: "jobs/job-1/foto.jpg",
          }),
        ],
        options: {
          margin: 12,
          pageSize: "A4",
        },
      }),
    );
    mocks.buildImages.mockImplementationOnce(
      async (args: {
        onProgress: (progress: number) => Promise<void> | void;
      }) => {
        await args.onProgress(50);
        return bytes;
      },
    );
    mocks.writePdf.mockResolvedValueOnce(output);

    await processPdfJob("job-1");

    expect(mocks.buildImages).toHaveBeenCalledWith(
      expect.objectContaining({
        margin: 12,
        pageSize: "A4",
      }),
    );
    expect(mocks.writePdf).toHaveBeenCalledWith(
      "job-1",
      "foto.pdf",
      bytes,
    );
    expect(mocks.artifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "jpg-output",
        jobId: "job-1",
        kind: "OUTPUT",
        mimeType: "application/pdf",
        pageCount: 1,
        sizeBytes: 30n,
      }),
    });
    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        outputBytes: 30n,
        progress: 100,
        status: "SUCCEEDED",
      }),
    });
  });

  it("renders PDF pages to JPEG outputs and persists their total size", async () => {
    const firstOutput = generatedOutput(
      "image-out-1",
      "arquivo-pagina-001.jpg",
      "jobs/job-1/page-1.jpg",
      10n,
    );
    const secondOutput = generatedOutput(
      "image-out-2",
      "arquivo-pagina-002.jpg",
      "jobs/job-1/page-2.jpg",
      20n,
    );

    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        operation: "PDF_TO_JPG",
        artifacts: [
          inputArtifact({
            id: "input-123",
          }),
        ],
        options: {
          manifest: manifestFor(),
          dpi: 150,
          quality: 82,
        },
      }),
    );

    mocks.writeBinary
      .mockResolvedValueOnce(firstOutput)
      .mockResolvedValueOnce(secondOutput);

    mocks.renderJpeg.mockImplementationOnce(
      async (args: {
        onProgress: (progress: number) => Promise<void> | void;
        onOutput: (
          instruction: unknown,
          bytes: Uint8Array,
          outputIndex: number,
        ) => Promise<void>;
      }) => {
        await args.onProgress(40);
        await args.onOutput({}, new Uint8Array([1]), 0);
        await args.onOutput({}, new Uint8Array([2]), 1);
      },
    );

    await processPdfJob("job-1");

    expect(mocks.writeBinary).toHaveBeenNthCalledWith(
      1,
      "job-1",
      "arquivo-pagina-001.jpg",
      "jpg",
      expect.any(Uint8Array),
    );
    expect(mocks.writeBinary).toHaveBeenNthCalledWith(
      2,
      "job-1",
      "arquivo-pagina-002.jpg",
      "jpg",
      expect.any(Uint8Array),
    );
    expect(mocks.artifactCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "image-out-1",
          mimeType: "image/jpeg",
          pageCount: 1,
        }),
        expect.objectContaining({
          id: "image-out-2",
          mimeType: "image/jpeg",
          pageCount: 1,
        }),
      ],
    });
    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        outputBytes: 30n,
        progress: 100,
        status: "SUCCEEDED",
      }),
    });
  });

  it("splits a structural PDF into numbered outputs", async () => {
    const firstOutput = generatedOutput(
      "split-out-1",
      "arquivo-pagina-001.pdf",
      "jobs/job-1/split-1.pdf",
      15n,
    );
    const secondOutput = generatedOutput(
      "split-out-2",
      "arquivo-pagina-002.pdf",
      "jobs/job-1/split-2.pdf",
      25n,
    );

    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        operation: "SPLIT",
        artifacts: [
          inputArtifact({
            id: "input-123",
          }),
        ],
        options: {
          manifest: manifestFor(),
        },
      }),
    );

    mocks.writePdf
      .mockResolvedValueOnce(firstOutput)
      .mockResolvedValueOnce(secondOutput);

    mocks.splitStructural.mockImplementationOnce(
      async (args: {
        onProgress: (progress: number) => Promise<void> | void;
        onOutput: (
          instruction: unknown,
          bytes: Uint8Array,
          outputIndex: number,
        ) => Promise<void>;
      }) => {
        await args.onProgress(60);
        await args.onOutput({}, new Uint8Array([1]), 0);
        await args.onOutput({}, new Uint8Array([2]), 1);
      },
    );

    await processPdfJob("job-1");

    expect(mocks.writePdf).toHaveBeenNthCalledWith(
      1,
      "job-1",
      "arquivo-pagina-001.pdf",
      expect.any(Uint8Array),
    );
    expect(mocks.writePdf).toHaveBeenNthCalledWith(
      2,
      "job-1",
      "arquivo-pagina-002.pdf",
      expect.any(Uint8Array),
    );
    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        outputBytes: 40n,
        progress: 100,
        status: "SUCCEEDED",
      }),
    });
  });

  it("applies annotations after building the structural PDF", async () => {
    const structuralBytes = new Uint8Array([1, 2]);
    const annotatedBytes = new Uint8Array([3, 4]);
    const output = generatedOutput(
      "annotated-1",
      "arquivo-anotado.pdf",
      "jobs/job-1/annotated.pdf",
      50n,
    );

    mocks.findUnique.mockResolvedValueOnce(
      makeJob({
        operation: "ANNOTATE",
        artifacts: [
          inputArtifact({
            id: "input-123",
          }),
        ],
        options: {
          annotations: [],
          manifest: manifestFor(),
        },
      }),
    );
    mocks.buildStructural.mockResolvedValueOnce(structuralBytes);
    mocks.applyAnnotations.mockResolvedValueOnce(annotatedBytes);
    mocks.writePdf.mockResolvedValueOnce(output);

    await processPdfJob("job-1");

    expect(mocks.buildStructural).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: manifestFor(),
      }),
    );
    expect(mocks.applyAnnotations).toHaveBeenCalledWith({
      annotations: [],
      manifest: manifestFor(),
      pdfBytes: structuralBytes,
    });
    expect(mocks.writePdf).toHaveBeenCalledWith(
      "job-1",
      "arquivo-anotado.pdf",
      annotatedBytes,
    );
    expect(mocks.artifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "annotated-1",
        pageCount: 1,
        sizeBytes: 50n,
      }),
    });
  });
});
