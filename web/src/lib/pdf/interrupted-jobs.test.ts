import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findJobs: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { pdfJob: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueueJobId: (id: string) => `delivery-${id}`,
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
}));

import { reconcileInterruptedPdfJobs } from "./interrupted-jobs";

const now = new Date("2026-11-05T18:00:00Z");
const older = new Date("2026-11-05T17:55:00Z");
const row = { id: "job-1", status: "RUNNING", updatedAt: older };
const queue = { findJobs: mocks.findJobs };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([row]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("reconcileInterruptedPdfJobs", () => {
  it.each(["failed", "cancelled", "completed"])(
    "marks an unresolved execution as failed after terminal delivery %s",
    async (state) => {
      mocks.findJobs.mockResolvedValue([{ state, completedOn: older }]);

      await reconcileInterruptedPdfJobs(queue, undefined, now);

      expect(mocks.findJobs).toHaveBeenCalledWith("perfect-pdf-processing", { id: "delivery-job-1" });
      expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: row,
        data: expect.objectContaining({
          status: "FAILED", errorCode: "PDF_PROCESSING_INTERRUPTED", completedAt: now,
        }),
      });
    },
  );

  it.each(["active", "retry", "created"])("keeps a delivery in state %s", async (state) => {
    mocks.findJobs.mockResolvedValue([{ state, completedOn: older }]);
    await reconcileInterruptedPdfJobs(queue, undefined, now);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("allows recent settlement and queue publication to finish", async () => {
    mocks.findJobs.mockResolvedValueOnce([{ state: "failed", completedOn: now }])
      .mockResolvedValueOnce([]);
    await reconcileInterruptedPdfJobs(queue, undefined, now);
    await reconcileInterruptedPdfJobs(queue, undefined, now);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("closes a stranded queued job after the queue retention window", async () => {
    const abandoned = { ...row, status: "QUEUED", updatedAt: new Date("2026-11-04T17:00:00Z") };
    mocks.findMany.mockResolvedValue([abandoned]);
    mocks.findJobs.mockResolvedValue([]);
    await reconcileInterruptedPdfJobs(queue, undefined, now);
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
    await expect(reconcileInterruptedPdfJobs(queue, undefined, now)).rejects.toBe(error);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
