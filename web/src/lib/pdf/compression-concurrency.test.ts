import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env.PDF_COMPRESSION_RASTER_CONCURRENCY;
  vi.resetModules();
});

describe("PDF compression concurrency", () => {
  it("bounds concurrent mapping while preserving result order", async () => {
    const { mapWithConcurrency } = await import("@/lib/pdf/compression-concurrency");
    let active = 0;
    let maximumActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(maximumActive).toBeLessThanOrEqual(2);
  });

  it("handles empty input and invalid concurrency conservatively", async () => {
    const { mapWithConcurrency } = await import("@/lib/pdf/compression-concurrency");

    await expect(mapWithConcurrency([], 0, async (value) => value)).resolves.toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], 0, async (value) => value),
    ).resolves.toEqual([1, 2]);
  });

  it("serializes raster work when the configured slot count is one", async () => {
    process.env.PDF_COMPRESSION_RASTER_CONCURRENCY = "1";
    vi.resetModules();
    const { withRasterCompressionSlot } = await import(
      "@/lib/pdf/compression-concurrency"
    );

    let active = 0;
    let maximumActive = 0;
    const firstStarted: Array<() => void> = [];
    const releaseFirst: Array<() => void> = [];
    const started = new Promise<void>((resolve) => firstStarted.push(resolve));
    const gate = new Promise<void>((resolve) => releaseFirst.push(resolve));

    const first = withRasterCompressionSlot(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      firstStarted[0]?.();
      await gate;
      active -= 1;
      return "first";
    });

    await started;

    const second = withRasterCompressionSlot(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
      return "second";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maximumActive).toBe(1);

    releaseFirst[0]?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(maximumActive).toBe(1);
  });
});
