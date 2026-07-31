import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPdfDraftWithCapacity,
  PdfPublicCapacityError,
  reservePdfJobForQueue,
} from "@/lib/pdf/capacity";
import { ResourceCapacityError } from "@/lib/system/resource-capacity";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    pdfJob: {
      aggregate: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    assertResourceCapacity: vi.fn(),
    prisma: {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
      pdfJob: { findUnique: vi.fn() },
    },
    tx,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/system/resource-capacity", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/system/resource-capacity")
  >();
  return { ...original, assertResourceCapacity: mocks.assertResourceCapacity };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
});

const draftRequest = {
  expiresAt: new Date("2026-08-01T12:00:00Z"),
  isAuthenticated: false,
  operation: "COMPRESS" as const,
  ownerSessionHash: "owner-hash",
  principalKey: `ip:${"a".repeat(64)}`,
  tenantId: null,
  userId: null,
};

describe("createPdfDraftWithCapacity", () => {
  it("serializes and rejects a third open public job", async () => {
    mocks.tx.pdfJob.count.mockResolvedValue(2);

    await expect(createPdfDraftWithCapacity(draftRequest)).rejects.toBeInstanceOf(
      PdfPublicCapacityError,
    );
    expect(mocks.tx.pdfJob.create).not.toHaveBeenCalled();
    expect(mocks.tx.$queryRaw.mock.calls[0]?.[1]).toBe(
      `pdf:principal:${draftRequest.principalKey}`,
    );
  });

  it("does not apply the public quota to an authenticated principal", async () => {
    const created = { id: "job-1" };
    mocks.tx.pdfJob.create.mockResolvedValue(created);

    await expect(
      createPdfDraftWithCapacity({
        ...draftRequest,
        isAuthenticated: true,
        ownerSessionHash: null,
        principalKey: `user:${"b".repeat(64)}`,
        userId: "user-1",
      }),
    ).resolves.toBe(created);
    expect(mocks.tx.pdfJob.count).not.toHaveBeenCalled();
  });
});

describe("reservePdfJobForQueue", () => {
  it("locks global, principal and job before claiming capacity", async () => {
    mocks.prisma.pdfJob.findUnique.mockResolvedValue({
      inputBytes: 1024n,
      operation: "COMPRESS",
    });
    mocks.tx.pdfJob.findUnique.mockResolvedValue({
      inputBytes: 1024n,
      status: "DRAFT",
    });
    mocks.tx.pdfJob.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mocks.tx.pdfJob.aggregate.mockResolvedValue({ _sum: { inputBytes: 0n } });
    mocks.tx.pdfJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      reservePdfJobForQueue({
        isAuthenticated: false,
        jobId: "job-1",
        principalKey: draftRequest.principalKey,
      }),
    ).resolves.toBe(true);

    expect(mocks.tx.$queryRaw.mock.calls.map((call) => call[1])).toEqual([
      "pdf:admission:global",
      `pdf:principal:${draftRequest.principalKey}`,
      "pdf:job:job-1",
    ]);
    expect(mocks.tx.pdfJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not claim a job when the global queue is full", async () => {
    mocks.prisma.pdfJob.findUnique.mockResolvedValue({
      inputBytes: 1024n,
      operation: "COMPRESS",
    });
    mocks.tx.pdfJob.findUnique.mockResolvedValue({
      inputBytes: 1024n,
      status: "DRAFT",
    });
    mocks.tx.pdfJob.count.mockResolvedValueOnce(12).mockResolvedValueOnce(0);
    mocks.tx.pdfJob.aggregate.mockResolvedValue({ _sum: { inputBytes: 0n } });

    await expect(
      reservePdfJobForQueue({
        isAuthenticated: false,
        jobId: "job-1",
        principalKey: draftRequest.principalKey,
      }),
    ).rejects.toBeInstanceOf(ResourceCapacityError);
    expect(mocks.tx.pdfJob.updateMany).not.toHaveBeenCalled();
  });
});
