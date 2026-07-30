import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  artifactDeleteMany: vi.fn(),
  captureException: vi.fn(),
  jobDeleteMany: vi.fn(),
  jobFindFirst: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  removeJobFiles: vi.fn(),
  removeStorageKey: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: mocks.captureException,
}));

vi.mock("@/lib/pdf/storage", () => ({
  removePdfJobFiles: mocks.removeJobFiles,
  removePdfStorageKey: mocks.removeStorageKey,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfArtifact: {
      deleteMany: mocks.artifactDeleteMany,
    },
    pdfJob: {
      deleteMany: mocks.jobDeleteMany,
      findFirst: mocks.jobFindFirst,
      findMany: mocks.jobFindMany,
      updateMany: mocks.jobUpdateMany,
    },
  },
}));

import {
  cleanupCompletedPdfJobInputs,
  cleanupExpiredPdfJobs,
} from "@/lib/pdf/retention";

describe("PDF storage cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artifactDeleteMany.mockResolvedValue({ count: 2 });
    mocks.jobDeleteMany.mockResolvedValue({ count: 1 });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.removeJobFiles.mockResolvedValue(undefined);
    mocks.removeStorageKey.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  });

  it("removes consumed inputs after a successful job", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      artifacts: [
        {
          id: "input-1",
          kind: "INPUT",
          storageKey: "job/input/one.pdf",
          sizeBytes: BigInt(1_000),
        },
        {
          id: "preview-1",
          kind: "PREVIEW",
          storageKey: "job/preview/one.png",
          sizeBytes: BigInt(200),
        },
      ],
    });

    await expect(cleanupCompletedPdfJobInputs("job-1")).resolves.toEqual({
      removed: 2,
    });
    expect(mocks.removeStorageKey).toHaveBeenCalledTimes(2);
    expect(mocks.artifactDeleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["input-1", "preview-1"] },
        jobId: "job-1",
        kind: { in: ["INPUT", "PREVIEW"] },
      },
    });
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "SUCCEEDED" },
      data: { inputBytes: BigInt(0) },
    });
  });

  it("keeps failed file metadata so retention can retry cleanup", async () => {
    mocks.jobFindFirst.mockResolvedValue({
      artifacts: [
        {
          id: "input-failed",
          kind: "INPUT",
          storageKey: "job/input/failed.pdf",
          sizeBytes: BigInt(1_500),
        },
        {
          id: "preview-removed",
          kind: "PREVIEW",
          storageKey: "job/preview/removed.png",
          sizeBytes: BigInt(300),
        },
      ],
    });
    mocks.removeStorageKey
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockResolvedValueOnce(undefined);

    await expect(cleanupCompletedPdfJobInputs("job-1")).resolves.toEqual({
      removed: 1,
    });
    expect(mocks.artifactDeleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["preview-removed"] },
        jobId: "job-1",
        kind: { in: ["INPUT", "PREVIEW"] },
      },
    });
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "SUCCEEDED" },
      data: { inputBytes: BigInt(1_500) },
    });
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("deletes expired files and database records permanently", async () => {
    mocks.jobFindMany.mockResolvedValue([
      { id: "job-expired", status: "SUCCEEDED" },
    ]);

    await expect(
      cleanupExpiredPdfJobs(new Date("2026-07-29T12:00:00.000Z")),
    ).resolves.toEqual({ cleaned: 1, scanned: 1 });
    expect(mocks.removeJobFiles).toHaveBeenCalledWith("job-expired");
    expect(mocks.jobDeleteMany).toHaveBeenCalledWith({
      where: { id: "job-expired", status: "EXPIRED" },
    });
  });
});
