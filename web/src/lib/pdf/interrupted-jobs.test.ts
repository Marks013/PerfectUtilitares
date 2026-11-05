import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findJobs: vi.fn(),
  findMany: vi.fn(),
  send: vi.fn(),
  transaction: vi.fn(),
  txUpdate: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfJob: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  },
}));
vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueueJobId: (id: string, attempt: number) => `delivery-${id}-${attempt}`,
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
  PDF_RECOVERY_ATTEMPT: 1,
}));

import { reconcileInterruptedPdfJobs } from "./interrupted-jobs";

const now = new Date("2026-11-05T18:00:00Z");
const older = new Date("2026-11-05T17:55:00Z");
const snapshot = { id: "job-1", status: "RUNNING", updatedAt: older, recoveryAttempt: 0 };
const row = {
  ...snapshot, expiresAt: new Date("2026-11-05T18:10:00Z"),
  principalKey: "principal-key", artifacts: [{ id: "input-1" }],
};
const failedDelivery = {
  state: "failed", completedOn: older, data: { jobId: row.id },
  groupId: row.principalKey, groupTier: "authenticated",
};
const queue = { findJobs: mocks.findJobs, send: mocks.send };
const run = () => reconcileInterruptedPdfJobs(queue, undefined, now);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([row]);
  mocks.findJobs.mockResolvedValue([failedDelivery]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.txUpdate.mockResolvedValue({ count: 1 });
  mocks.send.mockResolvedValue("delivery-job-1-1");
  mocks.transaction.mockImplementation((work) => work({ pdfJob: { updateMany: mocks.txUpdate } }));
});

describe("reconcileInterruptedPdfJobs", () => {
  it("atomically reserves one recovery and sends it under a different delivery ID", async () => {
    await run();

    expect(mocks.findJobs).toHaveBeenCalledWith("perfect-pdf-processing", { id: "delivery-job-1-0" });
    expect(mocks.txUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { ...snapshot, expiresAt: { gt: now } },
      data: {
        status: "QUEUED", recoveryAttempt: 1, startedAt: null, completedAt: null,
        errorCode: null, errorMessage: null, progress: 0,
      },
    });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith("perfect-pdf-processing",
      { jobId: "job-1", recoveryAttempt: 1 },
      {
        id: "delivery-job-1-1", retryLimit: 0, group: { id: row.principalKey, tier: "authenticated" },
        db: { executeSql: expect.any(Function) },
      },
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("never publishes when another reconciler or completion changed the job", async () => {
    mocks.txUpdate.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([run(), run()]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the transaction if the recovery delivery was not created", async () => {
    mocks.send.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("PDF_RECOVERY_NOT_ENQUEUED");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "completed"])("closes %s deliveries without recovery", async (state) => {
    mocks.findJobs.mockResolvedValue([{ ...failedDelivery, state }]);
    await run();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: snapshot,
      data: expect.objectContaining({
        status: "FAILED", errorCode: "PDF_PROCESSING_INTERRUPTED", completedAt: now,
      }),
    });
  });

  it.each([
    { recoveryAttempt: 1 }, { expiresAt: older }, { artifacts: [] }, { status: "QUEUED" },
  ])("does not recover an ineligible job %o", async (override) => {
    mocks.findMany.mockResolvedValue([{ ...row, ...override }]);
    await run();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });

  it.each(["active", "retry", "created"])("keeps a delivery in state %s", async (state) => {
    mocks.findJobs.mockResolvedValue([{ ...failedDelivery, state }]);
    await run();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("allows recent settlement and queue publication to finish", async () => {
    mocks.findJobs.mockResolvedValueOnce([{ ...failedDelivery, completedOn: now }])
      .mockResolvedValueOnce([]);
    await run();
    await run();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("closes a stranded queued job after the queue retention window", async () => {
    const abandoned = { ...snapshot, status: "QUEUED", updatedAt: new Date("2026-11-04T17:00:00Z") };
    mocks.findMany.mockResolvedValue([{ ...row, ...abandoned }]);
    mocks.findJobs.mockResolvedValue([]);
    await run();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: abandoned }));
  });

  it("bounds the scan and advances beyond healthy queued jobs", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ ...row, id: String(i) })));
    mocks.findJobs.mockResolvedValue([{ state: "retry" }]);
    await expect(reconcileInterruptedPdfJobs(queue, "cursor", now)).resolves.toBe("49");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50, where: expect.objectContaining({ id: { gt: "cursor" } }),
    }));
  });

  it("does not infer a missing delivery from a database error", async () => {
    const error = new Error("queue unavailable");
    mocks.findJobs.mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
