import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkQueue, stopWorkQueue } from "./queue";
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), on: vi.fn(), constructor: vi.fn() }));
vi.mock("pg-boss", () => ({ PgBoss: class {
  start = mocks.start; stop = mocks.stop; on = mocks.on;
  constructor(options: unknown) { mocks.constructor(options); }
} }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://unit-only.invalid/db");
  mocks.start.mockResolvedValue(undefined); mocks.stop.mockResolvedValue(undefined);
});
afterEach(async () => { await stopWorkQueue(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("shared durable work queue", () => {
  it("shares one connection and requests graceful draining for all consumers", async () => {
    const first = await getWorkQueue();
    expect(await getWorkQueue()).toBe(first);
    expect(mocks.start).toHaveBeenCalledOnce();
    await stopWorkQueue();
    expect(mocks.stop).toHaveBeenCalledWith({ graceful: true, timeout: 30_000 });
  });
  it("sanitizes driver errors and permits a later initialization retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.start.mockRejectedValueOnce(new Error("postgresql://private:credential@host/db"));
    await expect(getWorkQueue()).rejects.toThrow(/^WORK_QUEUE_UNAVAILABLE$/);
    await expect(getWorkQueue()).resolves.toBeDefined();
    const callback = mocks.on.mock.calls[0]?.[1];
    callback(new Error("private database payload"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
});
