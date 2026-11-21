import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedPoliciesFor, ESCALA_ACCESS_REQUEST_TIMEOUT_MS, startOperatorSession } from "./operational-client";

afterEach(() => vi.useRealTimers());
const context = { channel: "USERNAME", administrator: false, allBranches: false, roleLabel: "Filial B", branches: [] };
const success = () => Response.json({ access: { role: "OPERATIONAL", expiresAt: new Date(Date.now() + 3600000).toISOString() }, context });

describe("bounded access and approval requests", () => {
  it("ends a hung login even when the transport ignores abort and permits a fresh attempt", async () => {
    vi.useFakeTimers();
    let release: (response: Response) => void = () => undefined;
    const send = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const pending = startOperatorSession("A", send);
    const rejected = expect(pending).rejects.toThrow("demorou");
    await vi.advanceTimersByTimeAsync(ESCALA_ACCESS_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect((await startOperatorSession("B", async () => success())).context.roleLabel).toBe("Filial B");
    release(success());
    await Promise.resolve();
  });
  it("invalidates an explicitly cancelled login before a delayed success can be accepted", async () => {
    const abort = new AbortController();
    let release: (response: Response) => void = () => undefined;
    const pending = startOperatorSession("A", () => new Promise(resolve => { release = resolve; }), abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await rejected;
    release(success());
    expect((await startOperatorSession("B", async () => success())).context.roleLabel).toBe("Filial B");
  });
  it("times out an approval query with a recoverable error and aborts the underlying transport", async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = approvedPoliciesFor({ branchCode: "07", startDate: "2026-11-30", endDate: "2027-01-03" }, new AbortController().signal, send);
    const rejected = expect(pending).rejects.toThrow("demorou");
    await vi.advanceTimersByTimeAsync(ESCALA_ACCESS_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
