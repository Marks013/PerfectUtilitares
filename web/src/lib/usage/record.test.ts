import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { userUsageDaily: { upsert: mocks.upsert } },
}));

vi.mock("@/lib/usage/period", () => ({
  getUsageDate: () => new Date("2026-08-08T00:00:00.000Z"),
}));

import { recordUserUsage } from "./record";

describe("usage recording", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes operation, byte counters and persists an atomic upsert", async () => {
    await recordUserUsage({
      userId: "user-1",
      module: "PDF",
      operation: "  merge pdf  ",
      inputBytes: 12.9,
      outputBytes: -3,
      count: 2,
    });

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: {
        userId_date_module_operation: {
          userId: "user-1",
          date: new Date("2026-08-08T00:00:00.000Z"),
          module: "PDF",
          operation: "MERGE PDF",
        },
      },
      create: expect.objectContaining({
        count: 2,
        inputBytes: 12n,
        outputBytes: 0n,
      }),
      update: {
        count: { increment: 2 },
        inputBytes: { increment: 12n },
        outputBytes: { increment: 0n },
      },
    });
  });

  it("supports bigint counters and truncates operation length", async () => {
    await recordUserUsage({
      userId: "user-1",
      module: "FOTOS",
      operation: "x".repeat(100),
      inputBytes: 4n,
      outputBytes: 8n,
    });

    const call = mocks.upsert.mock.calls[0]?.[0];
    expect(call.create.operation).toHaveLength(80);
    expect(call.create.inputBytes).toBe(4n);
    expect(call.create.outputBytes).toBe(8n);
  });

  it("does nothing without user, positive count or operation", async () => {
    await recordUserUsage({
      userId: null,
      module: "PDF",
      operation: "MERGE",
    });
    await recordUserUsage({
      userId: "user-1",
      module: "PDF",
      operation: "MERGE",
      count: 0,
    });
    await recordUserUsage({
      userId: "user-1",
      module: "PDF",
      operation: "   ",
    });

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not fail the request when metric persistence is unavailable", async () => {
    const failure = new Error("database unavailable");
    mocks.upsert.mockRejectedValueOnce(failure);

    await expect(
      recordUserUsage({
        userId: "user-1",
        module: "JORNADA",
        operation: "VALIDAR",
        inputBytes: Number.NaN,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({ component: "usage-metrics" }),
      }),
    );
  });
});
