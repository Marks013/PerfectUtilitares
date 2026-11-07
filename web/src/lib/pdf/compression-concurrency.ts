import { addAbortListener } from "node:events";
import { getPdfExecutionAbortSignal } from "./execution-abort";

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
  private acquire(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let subscription: ReturnType<typeof addAbortListener> | undefined;
      const grant = () => {
        subscription?.[Symbol.dispose]();
        resolve();
      };
      this.queue.push(grant);
      if (signal) {
        subscription = addAbortListener(signal, () => {
          const index = this.queue.indexOf(grant);
          if (index < 0) return;
          this.queue.splice(index, 1);
          subscription?.[Symbol.dispose]();
          reject(signal.reason);
        });
      }
    });
  }

  private release() {
    const next = this.queue.shift();
    // Transfer the occupied slot directly; a new caller cannot overtake FIFO.
    if (next) next();
    else this.active -= 1;
  }

  async run<T>(task: () => Promise<T>) {
    const signal = getPdfExecutionAbortSignal();
    await this.acquire(signal);
    try {
      // An abort may follow acquisition but precede this continuation.
      signal?.throwIfAborted();
      return await task();
    } finally {
      this.release();
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
