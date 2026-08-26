import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), workers: [] as Array<{
    emit: (event: string, value?: unknown) => void;
    terminate: ReturnType<typeof vi.fn>;
    options: { env: Record<string, string>; resourceLimits: object };
  }>,
  finishTermination: undefined as (() => void) | undefined,
  delayTermination: false,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      stdout = { resume: vi.fn() };
      stderr = { resume: vi.fn() };
      terminate = vi.fn(() => mocks.delayTermination
        ? new Promise<number>((resolve) => { mocks.finishTermination = () => resolve(0); })
        : Promise.resolve(0));
      constructor(_path: string, public options: { env: Record<string, string>; resourceLimits: object }) {
        super();
        mocks.workers.push(this);
      }
    },
  };
});

import { FeriasError } from "@/lib/ferias/errors";
import { runFeriasWorkbook, withFeriasProcessing } from "@/lib/ferias/processing";

beforeEach(() => {
  mocks.transaction.mockReset();
  mocks.query.mockReset();
  mocks.workers.length = 0;
  mocks.delayTermination = false;
  mocks.finishTermination = undefined;
  mocks.query.mockResolvedValue([{ acquired: true }]);
  mocks.transaction.mockImplementation((operation) => operation({ $queryRaw: mocks.query }));
});
afterEach(() => { vi.useRealTimers(); });

describe("withFeriasProcessing", () => {
  it("uses a dedicated two-slot advisory transaction and accepts the second slot", async () => {
    mocks.query.mockResolvedValueOnce([{ acquired: false }]).mockResolvedValueOnce([{ acquired: true }]);
    await expect(withFeriasProcessing(new AbortController().signal, async () => "done")).resolves.toBe("done");
    expect(mocks.query.mock.calls.map((args) => args.slice(1))).toEqual([[1_179_796_819, 1], [1_179_796_819, 2]]);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 120_000 });
  });

  it("rejects a third concurrent operation without starting work", async () => {
    mocks.query.mockResolvedValue([{ acquired: false }]);
    const operation = vi.fn();
    await expect(withFeriasProcessing(new AbortController().signal, operation)).rejects.toMatchObject({ code: "FERIAS_BUSY", status: 503 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("preserves business errors and sanitizes database errors", async () => {
    const business = new FeriasError("FERIAS_PENDING", "Revise as pendências.", 422);
    await expect(withFeriasProcessing(new AbortController().signal, async () => { throw business; })).rejects.toBe(business);
    mocks.transaction.mockRejectedValueOnce(new Error("private connection string"));
    await expect(withFeriasProcessing(new AbortController().signal, async () => null)).rejects.toMatchObject({ code: "FERIAS_CAPACITY_UNAVAILABLE", status: 503 });
  });

  it("does not acquire a slot for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withFeriasProcessing(controller.signal, vi.fn())).rejects.toMatchObject({ code: "FERIAS_CANCELLED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("bounds the complete operation including stalled uploads", async () => {
    vi.useFakeTimers();
    const pending = withFeriasProcessing(new AbortController().signal, (signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60_000);
    await expectation;
  });

  it("cancels outstanding CPU work if its capacity transaction is lost", async () => {
    let failTransaction: ((reason: Error) => void) | undefined;
    mocks.transaction.mockImplementation((operation) => {
      void operation({ $queryRaw: mocks.query }).catch(() => undefined);
      return new Promise((_resolve, reject) => { failTransaction = reject; });
    });
    const pending = withFeriasProcessing(new AbortController().signal, (signal) => runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, signal));
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_CAPACITY_UNAVAILABLE" });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    failTransaction?.(new Error("connection lost"));
    await expectation;
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1);
  });
});

describe("runFeriasWorkbook", () => {
  it("returns parsed output only after terminating its worker", async () => {
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, new AbortController().signal);
    const worker = mocks.workers[0];
    worker.emit("message", { ok: true, value: { rows: [], competency: "2026-09" } });
    await expect(pending).resolves.toEqual({ rows: [], competency: "2026-09" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(Object.keys(worker.options.env).sort()).toEqual(["NODE_ENV", "TZ"]);
    expect(worker.options.resourceLimits).toMatchObject({ maxOldGenerationSizeMb: 128 });
  });

  it("holds the transaction until cancelled worker termination completes", async () => {
    mocks.delayTermination = true;
    const controller = new AbortController();
    let released = false;
    mocks.transaction.mockImplementation(async (operation) => {
      try { return await operation({ $queryRaw: mocks.query }); }
      finally { released = true; }
    });
    const pending = withFeriasProcessing(controller.signal, (signal) => runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, signal));
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_CANCELLED" });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    controller.abort();
    await vi.waitFor(() => expect(mocks.finishTermination).toBeTypeOf("function"));
    expect(released).toBe(false);
    mocks.finishTermination?.();
    await expectation;
    expect(released).toBe(true);
  });

  it("terminates a stalled worker at the bounded timeout", async () => {
    vi.useFakeTimers();
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, new AbortController().signal);
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "exit"])("sanitizes an unexpected %s", async (event) => {
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, new AbortController().signal);
    const expectation = expect(pending).rejects.toMatchObject({ status: 422 });
    mocks.workers[0].emit(event, new Error("private data"));
    await expectation;
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("preserves known validation errors", async () => {
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, new AbortController().signal);
    mocks.workers[0].emit("message", { ok: false, code: "FERIAS_XLSX_INVALID", message: "Formato inválido.", status: 422 });
    await expect(pending).rejects.toMatchObject({ code: "FERIAS_XLSX_INVALID", status: 422 });
  });

  it("returns bounded workbook bytes", async () => {
    const pending = runFeriasWorkbook({ action: "write", buffer: Buffer.from("fixture"), rows: [] }, new AbortController().signal);
    mocks.workers[0].emit("message", { ok: true, value: new Uint8Array([80, 75]) });
    await expect(pending).resolves.toEqual(Buffer.from([80, 75]));
  });
});
