import { describe, expect, it, vi } from "vitest";
import { retryUnimedWriteConflicts } from "@/lib/unimed/transaction-retry";

describe("Unimed transaction retry", () => {
  it("retries Prisma serializable write conflicts", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), { code: "P2034" }),
      )
      .mockResolvedValueOnce("ok");

    await expect(retryUnimedWriteConflicts(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry domain or validation failures", async () => {
    const error = new Error("invalid import");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(retryUnimedWriteConflicts(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("stops after the bounded number of retries", async () => {
    const conflict = Object.assign(new Error("conflict"), { code: "P2034" });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(conflict);

    await expect(retryUnimedWriteConflicts(operation)).rejects.toBe(conflict);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
