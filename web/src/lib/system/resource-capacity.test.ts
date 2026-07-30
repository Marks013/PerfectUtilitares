import { describe, expect, it } from "vitest";
import { evaluateResourceCapacity } from "@/lib/system/resource-capacity";

const config = {
  blockUsedPercent: 80,
  minimumFreeBytes: 30 * 1024 ** 3,
};

describe("resource capacity", () => {
  it("accepts a job while the reserve remains available", () => {
    expect(
      evaluateResourceCapacity(
        {
          availableBytes: 80 * 1024 ** 3,
          totalBytes: 200 * 1024 ** 3,
          usedPercent: 60,
          hostGuardBlocks: false,
        },
        { inputBytes: 500 * 1024 ** 2, multiplier: 8 },
        config,
      ),
    ).toMatchObject({ allowed: true });
  });

  it("blocks work when projected usage consumes the disk reserve", () => {
    expect(
      evaluateResourceCapacity(
        {
          availableBytes: 32 * 1024 ** 3,
          totalBytes: 200 * 1024 ** 3,
          usedPercent: 74,
          hostGuardBlocks: false,
        },
        { inputBytes: 500 * 1024 ** 2, multiplier: 8 },
        config,
      ),
    ).toMatchObject({
      allowed: false,
      code: "STORAGE_CAPACITY_LOW",
    });
  });

  it("honors a fresh host guard block", () => {
    expect(
      evaluateResourceCapacity(
        {
          availableBytes: 100 * 1024 ** 3,
          totalBytes: 200 * 1024 ** 3,
          usedPercent: 50,
          hostGuardBlocks: true,
        },
        { inputBytes: 1 },
        config,
      ),
    ).toMatchObject({
      allowed: false,
      code: "HOST_RESOURCE_PRESSURE",
    });
  });
});
