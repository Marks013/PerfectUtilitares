import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";

describe("cancelable raster slots", () => {
  async function setup() {
    process.env.PDF_COMPRESSION_RASTER_CONCURRENCY = "1";
    vi.resetModules();
    const { withRasterCompressionSlot } = await import("./compression-concurrency");
    const { runWithPdfAbortSignal } = await import("./execution-abort");
    return { slot: withRasterCompressionSlot, context: runWithPdfAbortSignal };
  }

  it("does not acquire a slot for an already canceled execution", async () => {
    const { slot, context } = await setup();
    const controller = new AbortController();
    const reason = new Error("canceled before acquisition");
    controller.abort(reason);
    const task = vi.fn().mockResolvedValue("unexpected");
    await expect(context(controller.signal, () => slot(task))).rejects.toBe(reason);
    expect(task).not.toHaveBeenCalled();
    await expect(slot(async () => "next")).resolves.toBe("next");
  });

  it("cancels a queued execution before the occupied slot is released", async () => {
    const { slot, context } = await setup();
    let release!: () => void;
    const held = slot(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue("unexpected");
    const pending = context(controller.signal, () => slot(task));
    const outcome = pending.then(() => "ran", (error) => error);
    const reason = new Error("canceled while queued");
    controller.abort(reason);
    try {
      expect(await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 20))])).toBe(reason);
      expect(task).not.toHaveBeenCalled();
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      release();
      await held;
      await outcome;
    }
    await expect(slot(async () => "next")).resolves.toBe("next");
  });

  it("preserves FIFO and removes a canceled middle waiter", async () => {
    const { slot, context } = await setup();
    let release!: () => void;
    const held = slot(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const order: number[] = [];
    const first = slot(async () => { order.push(1); });
    const controller = new AbortController();
    const middle = context(controller.signal, () => slot(async () => { order.push(2); }));
    const canceled = middle.catch((error) => error);
    const last = slot(async () => { order.push(3); });
    controller.abort();
    release();
    await Promise.all([held, first, canceled, last]);
    expect(order).toEqual([1, 3]);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("releases a handed-off slot exactly once if canceled before its task resumes", async () => {
    const { slot, context } = await setup();
    let release!: () => void;
    const held = slot(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue(undefined);
    const handedOff = context(controller.signal, () => slot(task));
    const canceled = handedOff.catch((error) => error);
    release();
    // The holder releases in its continuation, before this cancellation microtask.
    queueMicrotask(() => controller.abort());
    await held;
    await canceled;
    expect(task).not.toHaveBeenCalled();
    let active = 0;
    let maximum = 0;
    await Promise.all(Array.from({ length: 3 }, () => slot(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    })));
    expect(maximum).toBe(1);
  });

  it("releases a failed task and disposes the acquisition listener", async () => {
    const { slot, context } = await setup();
    const controller = new AbortController();
    const failed = context(controller.signal, () => slot(async () => {
      throw new Error("conversion failed");
    }));
    await expect(failed).rejects.toThrow("conversion failed");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await expect(slot(async () => "next")).resolves.toBe("next");
  });
});

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
