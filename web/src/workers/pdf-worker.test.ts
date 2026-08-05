import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn().mockResolvedValue(undefined),
  captureException: vi.fn(),
  cleanupExpired: vi.fn().mockResolvedValue(undefined),
  cleanupInputs: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  findUnique: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  processJob: vi.fn(),
  queryRaw: vi.fn().mockResolvedValue([]),
  rename: vi.fn().mockResolvedValue(undefined),
  stopQueue: vi.fn().mockResolvedValue(undefined),
  updateMany: vi.fn(),
  work: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@sentry/node", () => ({
  captureException: mocks.captureException,
  close: mocks.close,
  flush: mocks.flush,
  init: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  rename: mocks.rename,
  writeFile: mocks.writeFile,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $disconnect: mocks.disconnect,
    $queryRaw: mocks.queryRaw,
    pdfJob: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/pdf/processor", () => ({
  processPdfJob: mocks.processJob,
}));

vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueue: vi.fn().mockResolvedValue({ work: mocks.work }),
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
  stopPdfQueue: mocks.stopQueue,
}));

vi.mock("@/lib/pdf/constants", () => ({
  getPdfJobExpiry: vi.fn().mockReturnValue(new Date("2026-08-04T00:00:00Z")),
}));

vi.mock("@/lib/pdf/retention", () => ({
  cleanupCompletedPdfJobInputs: mocks.cleanupInputs,
  cleanupExpiredPdfJobs: mocks.cleanupExpired,
}));

type QueueJob = {
  data: { jobId: string };
  retryCount: number;
  retryLimit: number;
};

let handleJobs: (jobs: QueueJob[]) => Promise<void>;

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  await import("@/workers/pdf-worker");
  handleJobs = mocks.work.mock.calls[0]?.[2] as typeof handleJobs;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.processJob.mockResolvedValue(undefined);
});

const queueJob = (retryCount = 0): QueueJob => ({
  data: { jobId: "job-12345678" },
  retryCount,
  retryLimit: 2,
});

describe("PDF worker idempotency", () => {
  it("ignores a duplicate delivery after the job left QUEUED", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await handleJobs([queueJob()]);

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-12345678", status: "QUEUED" },
      }),
    );
    expect(mocks.processJob).not.toHaveBeenCalled();
    expect(mocks.cleanupInputs).not.toHaveBeenCalled();
  });

  it("claims and completes one queued delivery", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValueOnce({
      artifacts: [{ sha256: "abc", sizeBytes: 10n }],
      status: "SUCCEEDED",
    });

    await handleJobs([queueJob()]);

    expect(mocks.processJob).toHaveBeenCalledOnce();
    expect(mocks.cleanupInputs).toHaveBeenCalledWith("job-12345678");
  });

  it("never overwrites a valid terminal success after a processing error", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.processJob.mockRejectedValueOnce(new Error("duplicate delivery"));

    await expect(handleJobs([queueJob(2)])).rejects.toThrow("duplicate delivery");

    expect(mocks.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "job-12345678",
          status: { in: ["RUNNING", "FAILED"] },
        },
      }),
    );
  });

  it("marks a success with missing output as failed", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValueOnce({ artifacts: [], status: "SUCCEEDED" });

    await expect(handleJobs([queueJob(2)])).rejects.toThrow(
      "sem gerar um arquivo válido",
    );

    expect(mocks.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "job-12345678",
          status: { in: ["RUNNING", "FAILED", "SUCCEEDED"] },
        },
      }),
    );
  });
});
