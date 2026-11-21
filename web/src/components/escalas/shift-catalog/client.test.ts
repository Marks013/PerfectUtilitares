import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG_REQUEST_TIMEOUT_MS, catalogBytes, catalogRequest } from "./client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("catalog request lifetime", () => {
  it("bounds a hung transport and ignores its late unauthorized response", async () => {
    vi.useFakeTimers(); const target = new EventTarget(), locked = vi.fn(); target.addEventListener("escalas:unlock-required", locked); vi.stubGlobal("window", target);
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    const result = expect(catalogRequest("/mock")).rejects.toThrow(/demorou/);
    await vi.advanceTimersByTimeAsync(CATALOG_REQUEST_TIMEOUT_MS); await result;
    release(new Response(JSON.stringify({ error: { message: "old" } }), { status: 401 }));
    await vi.runAllTimersAsync(); expect(locked).not.toHaveBeenCalled();
  });
  it("checks cancellation after body parsing before dispatching an unauthorized event", async () => {
    const target = new EventTarget(), locked = vi.fn(), controller = new AbortController(); target.addEventListener("escalas:unlock-required", locked); vi.stubGlobal("window", target);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => { controller.abort(); return { error: { message: "old" } }; } })));
    await expect(catalogRequest("/mock", { signal: controller.signal })).rejects.toThrow(); expect(locked).not.toHaveBeenCalled();
  });
  it("returns a fresh valid result after an explicitly cancelled request", async () => {
    const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(new Response('{"entries":[]}')));
    const result = expect(catalogRequest("/old", { signal: controller.signal })).rejects.toThrow(); controller.abort(); await result;
    await expect(catalogRequest("/new")).resolves.toEqual({ entries: [] });
  });
  it("rejects an empty or incorrectly typed successful download and keeps genuine bytes intact", async () => {
    const signal = new AbortController().signal;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(new Response("", { headers: { "Content-Type": "text/plain" } })).mockResolvedValueOnce(new Response("0007,08:00\r\n", { headers: { "Content-Type": "text/plain;charset=utf-8" } })));
    await expect(catalogBytes("/file", signal)).rejects.toThrow(/TXT válido/); await expect(catalogBytes("/file", signal)).rejects.toThrow(/TXT válido/);
    expect(new TextDecoder().decode(await catalogBytes("/file", signal))).toBe("0007,08:00\r\n");
  });
});
