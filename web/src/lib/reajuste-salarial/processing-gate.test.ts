import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { runWithReajusteProcessingSlot } from "./processing-gate";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: mocks.queryRaw }),
  );
});

describe("salary adjustment distributed processing gate", () => {
  it("runs the operation after acquiring one of the two PostgreSQL slots", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ acquired: false }])
      .mockResolvedValueOnce([{ acquired: true }]);
    const operation = vi.fn(async () => "done");

    await expect(runWithReajusteProcessingSlot(operation)).resolves.toEqual({
      status: "acquired",
      value: "done",
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects excess work when both shared slots are occupied", async () => {
    mocks.queryRaw.mockResolvedValue([{ acquired: false }]);
    const operation = vi.fn(async () => "not-run");

    await expect(runWithReajusteProcessingSlot(operation)).resolves.toEqual({
      status: "busy",
    });
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("fails closed when PostgreSQL cannot coordinate capacity", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));

    await expect(
      runWithReajusteProcessingSlot(async () => "not-run"),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
