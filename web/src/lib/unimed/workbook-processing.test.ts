import { EventEmitter } from "node:events";
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
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    stdout = { resume: vi.fn() };
    stderr = { resume: vi.fn() };
    terminate = vi.fn(() => mocks.delayTermination
      ? new Promise<number>((resolve) => { mocks.finishTermination = () => resolve(0); })
      : Promise.resolve(0));
    constructor(_path: string, public options: { env: Record<string, string>; resourceLimits: object }) {
      super(); mocks.workers.push(this);
    }
  },
}));
import { readAddressWorkbook, UnimedWorkbookError } from "./workbook-processing";

beforeEach(() => {
  mocks.transaction.mockReset(); mocks.query.mockReset();
  mocks.workers.length = 0; mocks.delayTermination = false; mocks.finishTermination = undefined;
  mocks.query.mockResolvedValue([{ acquired: true }]);
  mocks.transaction.mockImplementation((operation) => operation({ $queryRaw: mocks.query }));
});
afterEach(() => vi.useRealTimers());
const signal = () => new AbortController().signal;
const read = (requestSignal = signal()) => readAddressWorkbook(Buffer.from("fixture"), requestSignal);

describe("bounded Unimed workbook processing", () => {
  it("shares the two Férias slots and does not start work when both are busy", async () => {
    mocks.query.mockResolvedValue([{ acquired: false }]);
    await expect(read()).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_BUSY", status: 503 });
    expect(mocks.query.mock.calls.map((args) => args.slice(1))).toEqual([[1_179_796_819, 1], [1_179_796_819, 2]]);
    expect(mocks.workers).toHaveLength(0);
  });
  it("limits memory, avoids credentials, and terminates before returning rows", async () => {
    const pending = read();
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    const worker = mocks.workers[0];
    worker.emit("message", { ok: true, rows: [["CADASTRO"], [123]] });
    await expect(pending).resolves.toEqual([["CADASTRO"], [123]]);
    expect(worker.options.resourceLimits).toMatchObject({ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 });
    expect(Object.keys(worker.options.env).sort()).toEqual(["NODE_ENV", "TZ"]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("holds its capacity slot until a cancelled worker has stopped", async () => {
    mocks.delayTermination = true;
    const controller = new AbortController(); let released = false;
    mocks.transaction.mockImplementation(async (operation) => {
      try { return await operation({ $queryRaw: mocks.query }); } finally { released = true; }
    });
    const pending = read(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_CANCELLED", status: 499 });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    controller.abort();
    await vi.waitFor(() => expect(mocks.finishTermination).toBeTypeOf("function"));
    expect(released).toBe(false); mocks.finishTermination?.(); await rejected;
    expect(released).toBe(true);
  });
  it("does not start a worker for an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(read(controller.signal)).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_CANCELLED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not start late work when cancelled during slot acquisition", async () => {
    let acquired: ((value: Array<{ acquired: boolean }>) => void) | undefined;
    mocks.query.mockImplementationOnce(() => new Promise((resolve) => { acquired = resolve; }));
    const controller = new AbortController();
    const pending = read(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_CANCELLED" });
    await vi.waitFor(() => expect(acquired).toBeTypeOf("function"));
    controller.abort(); acquired?.([{ acquired: true }]); await rejected;
    expect(mocks.workers).toHaveLength(0);
  });
  it("rejects expanded output with an actionable size error", async () => {
    const pending = read();
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_TOO_LARGE", status: 413 });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    mocks.workers[0].emit("message", { ok: false, code: "OUTPUT_TOO_LARGE" }); await rejected;
  });
  it("rejects oversized input before copying bytes into a worker", async () => {
    await expect(readAddressWorkbook(Buffer.alloc(10 * 1024 * 1024 + 1), signal())).rejects.toMatchObject({ status: 413 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("terminates a timed out parser", async () => {
    vi.useFakeTimers(); const pending = read();
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1);
  });
  it.each(["error", "exit"])("sanitizes worker %s without publishing rows", async (event) => {
    const pending = read(); const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_UNAVAILABLE", status: 503 });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    mocks.workers[0].emit(event, new Error("private payload")); await rejected;
  });
  it("identifies worker memory exhaustion without exposing runtime details", async () => {
    const pending = read();
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_TOO_LARGE", status: 413 });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    mocks.workers[0].emit("error", Object.assign(new Error("private memory details"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await rejected;
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1);
  });
  it("bounds rows even if a worker reply is malformed", async () => {
    const pending = read(); const rejected = expect(pending).rejects.toBeInstanceOf(UnimedWorkbookError);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    mocks.workers[0].emit("message", { ok: true, rows: new Array(100_001).fill([]) }); await rejected;
  });
  it("keeps actionable workbook errors and sanitizes database failures", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("private connection"));
    await expect(read()).rejects.toMatchObject({ code: "UNIMED_WORKBOOK_CAPACITY_UNAVAILABLE", status: 503 });
    const pending = read(); const rejected = expect(pending).rejects.toMatchObject({ code: "UNIMED_ADDRESS_FILE_INVALID", status: 400 });
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    mocks.workers[0].emit("message", { ok: false, message: "Confira o formato XLSX." }); await rejected;
  });
});
