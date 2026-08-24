import { describe, expect, it } from "vitest";
import { tryAcquireReajusteProcessingSlot } from "./processing-gate";

describe("salary adjustment processing gate", () => {
  it("allows two jobs and releases capacity safely", () => {
    const releaseFirst = tryAcquireReajusteProcessingSlot();
    const releaseSecond = tryAcquireReajusteProcessingSlot();
    expect(releaseFirst).toBeTypeOf("function");
    expect(releaseSecond).toBeTypeOf("function");
    expect(tryAcquireReajusteProcessingSlot()).toBeNull();

    releaseFirst?.();
    releaseFirst?.();
    const releaseThird = tryAcquireReajusteProcessingSlot();
    expect(releaseThird).toBeTypeOf("function");

    releaseSecond?.();
    releaseThird?.();
  });
});
