export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length || 1, Math.floor(concurrency)));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await mapper(item, index);
      }
    }),
  );
  return results;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>) {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

function readRasterConcurrency() {
  const parsed = Number(process.env.PDF_COMPRESSION_RASTER_CONCURRENCY ?? 1);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1;
}

const rasterSemaphore = new Semaphore(readRasterConcurrency());
export function withRasterCompressionSlot<T>(task: () => Promise<T>) {
  return rasterSemaphore.run(task);
}
