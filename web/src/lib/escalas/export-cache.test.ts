import { afterEach, describe, expect, it, vi } from "vitest";
import { createEscalaExportCache } from "./export-cache";

afterEach(() => vi.useRealTimers());
const file = (...bytes: number[]) => new Uint8Array(bytes);

describe("bounded schedule export cache", () => {
  it("coalesces the same authorized revision while limiting different concurrent builds", async () => {
    const cache = createEscalaExportCache({ concurrency: 1 });
    let finish!: (value: Uint8Array) => void;
    const generate = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
    const first = cache.get("tenant/workspace/1/both/pdf", generate);
    const second = cache.get("tenant/workspace/1/both/pdf", generate);
    await Promise.resolve();
    await expect(cache.get("other", () => file(9))).rejects.toMatchObject({ code: "ESCALA_EXPORT_BUSY", status: 429 });
    finish(file(1, 2));
    expect(await first).toEqual(file(1, 2));
    expect(await second).toEqual(file(1, 2));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await cache.get("tenant/workspace/1/both/pdf", generate)).toEqual(file(1, 2));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not retain failed builds or consume their concurrency slot", async () => {
    const cache = createEscalaExportCache({ concurrency: 1 });
    await expect(cache.get("a", () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await cache.get("a", () => file(3))).toEqual(file(3));
  });

  it("expires cached bytes without extending their lifetime on a hit", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const cache = createEscalaExportCache({ ttlMs: 100 });
    const generate = vi.fn(() => file(1));
    await cache.get("a", generate);
    vi.setSystemTime(1090); await cache.get("a", generate);
    expect(generate).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1100); await cache.get("a", generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("evicts least-recently-used entries under the byte budget", async () => {
    const cache = createEscalaExportCache({ maxBytes: 4 });
    const a = vi.fn(() => file(1, 1)), b = vi.fn(() => file(2, 2)), c = vi.fn(() => file(3, 3));
    await cache.get("a", a); await cache.get("b", b); await cache.get("a", a); await cache.get("c", c);
    await cache.get("a", a); expect(a).toHaveBeenCalledTimes(1);
    await cache.get("b", b); expect(b).toHaveBeenCalledTimes(2);
  });

  it("also bounds entry count and does not cache files larger than the budget", async () => {
    const cache = createEscalaExportCache({ maxEntries: 1, maxBytes: 3 });
    const a = vi.fn(() => file(1)), large = vi.fn(() => file(1, 2, 3, 4));
    await cache.get("a", a); await cache.get("b", () => file(2)); await cache.get("a", a);
    expect(a).toHaveBeenCalledTimes(2);
    await cache.get("large", large); await cache.get("large", large);
    expect(large).toHaveBeenCalledTimes(2);
  });
});
