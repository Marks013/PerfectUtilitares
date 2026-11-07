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
  registerRecovery: vi.fn().mockResolvedValue(undefined),
  queryRaw: vi.fn().mockResolvedValue([]),
  reconcile: vi.fn().mockResolvedValue(undefined),
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
vi.mock("@/lib/auth/password-recovery-worker", () => ({
  registerPasswordRecoveryWorker: mocks.registerRecovery,
}));

vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueue: vi.fn().mockResolvedValue({ work: mocks.work }),
  getPdfQueueJobId: (id: string, attempt: number) => `${id}-${attempt}`,
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
  PDF_RECOVERY_ATTEMPT: 1,
  stopPdfQueue: mocks.stopQueue,
}));

vi.mock("@/lib/pdf/interrupted-jobs", () => ({
  reconcileInterruptedPdfJobs: mocks.reconcile,
}));

vi.mock("@/lib/pdf/retention", () => ({
  cleanupCompletedPdfJobInputs: mocks.cleanupInputs,
  cleanupExpiredPdfJobs: mocks.cleanupExpired,
}));

type QueueJob = {
  id: string;
  data: { jobId: string; recoveryAttempt?: number };
  retryCount: number;
  retryLimit: number;
  signal?: AbortSignal;
};

let handleJobs: (jobs: QueueJob[]) => Promise<void>;
let recoveryReadyBeforeHeartbeat = false;

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  await import("@/workers/pdf-worker");
  handleJobs = mocks.work.mock.calls[0]?.[2] as typeof handleJobs;
  recoveryReadyBeforeHeartbeat = mocks.registerRecovery.mock.calls.length === 1
    && mocks.registerRecovery.mock.calls[0]?.[0]?.work === mocks.work
    && mocks.registerRecovery.mock.invocationCallOrder[0] < mocks.writeFile.mock.invocationCallOrder[0];
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockReset();
  mocks.updateMany.mockReset();
  mocks.processJob.mockResolvedValue(undefined);
});

const queueJob = (retryCount = 0, recoveryAttempt = 0): QueueJob => ({
  id: `job-12345678-${recoveryAttempt}`,
  data: { jobId: "job-12345678", recoveryAttempt },
  retryCount,
  retryLimit: 2,
});

describe("PDF worker idempotency", () => {
  it("registers recovery on the shared queue before publishing readiness", () => {
    expect(recoveryReadyBeforeHeartbeat).toBe(true);
  });

  it("does not acknowledge a redelivery while the persisted job is still running", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({ status: "RUNNING" });
    await expect(handleJobs([queueJob(1)])).rejects.toThrow("PDF_PROCESSING_ALREADY_RUNNING");
    expect(mocks.processJob).not.toHaveBeenCalled();
    expect(mocks.cleanupInputs).not.toHaveBeenCalled();
  });

  it.each([
    "PDF_OFFICE_PAGE_LIMIT", "PDF_IMAGE_TOO_LARGE", "PDF_OFFICE_OCR_NO_TEXT",
    "INVALID_PDF", "INVALID_IMAGE_OPTIONS", "PDF_PAGE_NOT_FOUND",
    "PDF_TOOL_UNAVAILABLE", "PDF_RENDERER_UNAVAILABLE", "PDF_ANALYZER_UNAVAILABLE",
    "PDF_WORKER_VERSION_MISMATCH", "PDF_SEMANTIC_INTEGRITY_FAILED",
    "OFFICE_TOOL_UNAVAILABLE", "OPERATION_NOT_READY",
    "PDF_STRUCTURAL_INTEGRITY_FAILED", "PDF_VISUAL_INTEGRITY_FAILED",
  ])(
    "keeps %s terminal without repeating an unchanged conversion",
    async (code) => {
      mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
      mocks.processJob.mockRejectedValueOnce(Object.assign(new Error("Confira o PDF."), { code }));

      await expect(handleJobs([queueJob()])).resolves.toBeUndefined();
      expect(mocks.processJob).toHaveBeenCalledOnce();

      expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", errorCode: code,
          errorMessage: "Confira o PDF.", completedAt: expect.any(Date) }),
      }));
      expect(mocks.cleanupInputs).not.toHaveBeenCalled();
    },
  );

  it.each([0, 2])("preserves transient timeout codes and retry policy at attempt %i", async (retryCount) => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    const error = Object.assign(new Error("Converter temporarily unavailable"), { code: "PDF_COMPRESSION_TIMEOUT" });
    mocks.processJob.mockRejectedValueOnce(error);

    await expect(handleJobs([queueJob(retryCount)])).rejects.toBe(error);
    expect(mocks.processJob).toHaveBeenCalledOnce();

    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: retryCount < 2 ? "QUEUED" : "FAILED",
        errorCode: "PDF_COMPRESSION_TIMEOUT", completedAt: retryCount < 2 ? null : expect.any(Date) }),
    }));
  });

  it("completes the next delivery after one transient processing failure", async () => {
    const error = Object.assign(new Error("temporary resource pressure"), { code: "EAGAIN" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.processJob.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    mocks.findUnique.mockResolvedValueOnce({
      artifacts: [{ sha256: "valid", sizeBytes: 10n }], status: "SUCCEEDED",
    });
    await expect(handleJobs([queueJob()])).rejects.toBe(error);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "QUEUED", errorCode: "EAGAIN" }),
    }));
    await expect(handleJobs([queueJob(1)])).resolves.toBeUndefined();
    expect(mocks.processJob).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupInputs).toHaveBeenCalledExactlyOnceWith("job-12345678");
  });

  it("ignores a duplicate delivery after the job left QUEUED", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await handleJobs([queueJob()]);

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-12345678", status: "QUEUED", recoveryAttempt: 0 },
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

    expect(mocks.processJob).toHaveBeenCalledExactlyOnceWith(
      { id: "job-12345678", startedAt: expect.any(Date), recoveryAttempt: 0 },
      expect.any(AbortSignal),
    );
    expect(mocks.cleanupInputs).toHaveBeenCalledWith("job-12345678");
  });

  it("does not let the original delivery claim a recovered job", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce(null);
    await handleJobs([queueJob()]);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-12345678", status: "QUEUED", recoveryAttempt: 0 },
    }));
    expect(mocks.processJob).not.toHaveBeenCalled();
    expect(mocks.cleanupInputs).not.toHaveBeenCalled();
  });

  it("processes the distinct recovery delivery once under its own generation", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValueOnce({
      status: "SUCCEEDED", artifacts: [{ sha256: "valid", sizeBytes: 10n }],
    });
    await handleJobs([{ ...queueJob(0, 1), retryLimit: 0 }]);
    expect(mocks.processJob).toHaveBeenCalledExactlyOnceWith(
      { id: "job-12345678", startedAt: expect.any(Date), recoveryAttempt: 1 },
      expect.any(AbortSignal),
    );
    expect(mocks.cleanupInputs).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched generation before claiming the job", async () => {
    await handleJobs([{ ...queueJob(0, 1), id: "job-12345678-0" }]);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.processJob).not.toHaveBeenCalled();
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
          status: "RUNNING",
          startedAt: expect.any(Date),
          recoveryAttempt: 0,
        },
      }),
    );
  });

  it("does not let an expired callback requeue the application job", async () => {
    const controller = new AbortController();
    const error = new Error("queue delivery expired");
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.processJob.mockImplementationOnce(async () => {
      controller.abort(error);
      throw error;
    });
    await expect(handleJobs([{ ...queueJob(), signal: controller.signal }])).rejects.toBe(error);
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.cleanupInputs).not.toHaveBeenCalled();
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
          status: "SUCCEEDED",
          startedAt: expect.any(Date),
          recoveryAttempt: 0,
        },
      }),
    );
  });
});
