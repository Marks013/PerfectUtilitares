import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationOperation, generationCancellationNotice } from "./generation-operation";
const started = { operationId: "b4a12ea7-3845-440e-8206-7e0eae71fb8a", state: "CREATED", expiresAt: "2026-10-30T11:00:00Z" };
const stopped = { operationId: started.operationId, state: "CANCELLED" };
afterEach(() => vi.useRealTimers());

describe("server-confirmed generation cancellation", () => {
  it("never sends a calculation when cancelled before registration", async () => {
    const post = vi.fn(); const operation = new GenerationOperation(post);
    expect(await operation.cancel()).toBeNull();
    expect(await operation.start("plan", 2)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it("waits for a pending registration and cancels that exact operation", async () => {
    let resolveStart: (value: typeof started) => void = () => {};
    const post = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveStart = resolve; })).mockResolvedValueOnce(stopped);
    const operation = new GenerationOperation(post);
    const beginning = operation.start("plan", 2);
    const cancel = operation.cancel();
    expect(operation.cancellationPending).toBe(true);
    expect(post).toHaveBeenCalledOnce();
    resolveStart(started);
    expect(await cancel).toEqual(stopped);
    expect(await beginning).toBeNull();
    expect(operation.cancellationPending).toBe(false);
    expect(post.mock.calls[1][0]).toEqual({ action: "CANCEL_GENERATION", operationId: started.operationId });
    expect(post.mock.calls[1][1].aborted).toBe(false);
  });
  it("deduplicates simultaneous cancellation and polls a pending request until confirmed", async () => {
    const post = vi.fn().mockResolvedValueOnce(started).mockResolvedValueOnce({ operationId: started.operationId, state: "CANCEL_REQUESTED" }).mockResolvedValueOnce(stopped);
    const operation = new GenerationOperation(post, async () => undefined);
    await operation.start("plan", 2);
    const first = operation.cancel(); const second = operation.cancel();
    expect(first).toBe(second);
    expect(await first).toEqual(stopped);
    expect(post.mock.calls.map(([body]) => body.action)).toEqual(["START_GENERATION", "CANCEL_GENERATION", "GENERATION_STATUS"]);
    expect(await operation.cancel()).toEqual(stopped);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it("distinguishes already-completed calculations and never says they were cancelled", async () => {
    const post = vi.fn().mockResolvedValueOnce(started).mockResolvedValueOnce({ operationId: started.operationId, state: "COMPLETED" });
    const operation = new GenerationOperation(post);
    await operation.start("plan", 2);
    const status = await operation.cancel();
    expect(generationCancellationNotice(status)).toContain("já havia terminado; a proposta não foi aplicada");
    expect(generationCancellationNotice(status)).not.toContain("Cálculo cancelado");
  });
  it("retains the busy guard when a different operation is returned and permits a later confirmation retry", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValueOnce(started).mockResolvedValue({ operationId: "another-operation", state: "CANCELLED" });
    const operation = new GenerationOperation(post);
    await operation.start("plan", 2);
    const rejected = expect(operation.cancel()).rejects.toThrow("ainda não foi confirmado");
    await vi.advanceTimersByTimeAsync(10_100); await rejected;
    expect(operation.cancellationPending).toBe(true);
    post.mockResolvedValue(stopped);
    expect(await operation.cancel()).toEqual(stopped);
    expect(operation.cancellationPending).toBe(false);
  });
  it("does not start the solver or invent cancellation success after registration fails", async () => {
    const post = vi.fn().mockRejectedValue(new Error("Registration unavailable"));
    const operation = new GenerationOperation(post);
    await expect(operation.start("plan", 2)).rejects.toThrow("Registration unavailable");
    expect(await operation.cancel()).toBeNull();
    expect(post).toHaveBeenCalledOnce();
  });
});
