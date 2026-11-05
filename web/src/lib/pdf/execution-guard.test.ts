import { afterEach, describe, expect, it, vi } from "vitest";
import { guardPdfExecution } from "./execution-guard";

afterEach(() => vi.useRealTimers());

describe("PDF execution guard", () => {
  it("aborts a superseded attempt and stops checking after it is released", async () => {
    vi.useFakeTimers();
    const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const attempt = guardPdfExecution(isCurrent);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt.signal.reason).toMatchObject({ message: "PDF_EXECUTION_LEASE_LOST" });
    attempt.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isCurrent).toHaveBeenCalledTimes(2);
  });

  it("fails closed on loss of database connectivity", async () => {
    vi.useFakeTimers();
    const attempt = guardPdfExecution(vi.fn().mockRejectedValue(new Error("database offline")));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt.signal.aborted).toBe(true);
    attempt.stop();
  });

  it("propagates the queue abort immediately", () => {
    const controller = new AbortController();
    const attempt = guardPdfExecution(vi.fn(), controller.signal);
    controller.abort(new Error("queue timeout"));
    expect(attempt.signal.reason).toBe(controller.signal.reason);
    attempt.stop();
  });
});
