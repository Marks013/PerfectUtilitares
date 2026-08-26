import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const cleanups = new Map<number, () => void>();
  let cursor = 0;
  return {
    begin() { cursor = 0; },
    reset() { slots.length = 0; cleanups.clear(); cursor = 0; },
    cleanup() { for (const fn of cleanups.values()) fn(); cleanups.clear(); },
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index] as T, (value: T | ((current: T) => T)) => {
        slots[index] = typeof value === "function" ? (value as (current: T) => T)(slots[index] as T) : value;
      }] as const;
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useCallback<T>(fn: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = fn;
      return slots[index] as T;
    },
    useEffect(fn: () => undefined | (() => void), deps: unknown[]) {
      const index = cursor++;
      const old = slots[index] as unknown[] | undefined;
      if (old && deps.every((value, i) => Object.is(value, old[i]))) return;
      cleanups.get(index)?.();
      slots[index] = deps;
      const cleanup = fn();
      if (cleanup) cleanups.set(index, cleanup);
      else cleanups.delete(index);
    },
  };
});
vi.mock("react", () => runtime);
import { useFeriasWorkspace } from "./use-ferias-workspace";

const analysis = {
  competency: "2026-09", revision: "revision-1", sources: [{ name: "Unimed", ready: true }],
  pricePeriods: ["2026-09"], issues: [], rows: [],
  summary: { total: 1, unimed: 1, loans: 0, pending: 0, highlighted: 0 }, canExport: true,
};
const fetchMock = vi.fn<typeof fetch>();
const createUrl = vi.fn(() => "blob:ferias");
const revokeUrl = vi.fn();
const click = vi.fn();
const append = vi.fn();
const remove = vi.fn();

function TestWorkspace() { runtime.begin(); return useFeriasWorkspace(); }
const render = TestWorkspace;
function select() { render().selectFile(new File(["xlsx-content"], "ferias.xlsx")); return render(); }
async function ready() {
  fetchMock.mockResolvedValueOnce(Response.json(analysis));
  await select().run("analisar");
  return render();
}

beforeEach(() => {
  runtime.reset(); vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { createElement: () => ({ click, remove }), body: { append } });
  vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
});
afterEach(() => { runtime.cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Ferias UI request lifecycle", () => {
  it("analyzes the original file and choices without client amounts", async () => {
    const state = await ready();
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect([...form.keys()]).toEqual(["file", "choices"]);
    expect(form.get("choices")).toBe("[]");
    expect(state.analysis).toEqual(analysis);
    expect(state.stale).toBe(false);
    expect(state.phase).toBe("idle");
  });

  it("requires reanalysis after selecting or clearing an identity", async () => {
    (await ready()).choose(4, "holderId", "holder-1");
    expect(render().stale).toBe(true);
    await render().run("exportar");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    render().choose(4, "loanIdentity", "loan-1");
    render().choose(4, "holderId", "");
    expect(render().choices).toEqual([{ row: 4, holderId: undefined, loanIdentity: "loan-1" }]);
    fetchMock.mockResolvedValueOnce(Response.json(analysis));
    await render().run("analisar");
    expect(render().stale).toBe(false);
    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(form.get("choices")).toContain("loan-1");
  });

  it("discards a late response when the file changes", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = select().run("analisar");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    render().selectFile(new File(["other"], "other.xlsx"));
    resolve(Response.json(analysis));
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(render().analysis).toBeNull();
    expect(render().file?.name).toBe("other.xlsx");
  });

  it("cancels without allowing an ignored-abort response to update results", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = select().run("analisar");
    render().cancel();
    resolve(Response.json(analysis));
    await pending;
    expect(render().phase).toBe("idle");
    expect(render().analysis).toBeNull();
  });

  it("keeps downloaded content alive and supports re-download", async () => {
    await ready();
    fetchMock.mockResolvedValueOnce(new Response("PK-test", { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }));
    await render().run("exportar");
    expect(render().download).toEqual({ url: "blob:ferias", name: "FERIAS-09-2026-CONFERIDO.xlsx" });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(form.get("revision")).toBe("revision-1");
    expect(revokeUrl).not.toHaveBeenCalled();
    render().selectFile(null);
    render();
    expect(revokeUrl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeUrl).toHaveBeenCalledWith("blob:ferias");
  });

  it("blocks export after a source revision conflict", async () => {
    await ready();
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "STALE", message: "As bases mudaram." } }, { status: 409 }));
    await render().run("exportar");
    expect(render().error).toBe("As bases mudaram.");
    expect(render().stale).toBe(true);
    await render().run("exportar");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed analysis and non-XLSX downloads", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ broken: true }));
    await select().run("analisar");
    expect(render().analysis).toBeNull();
    expect(render().error).toBeTruthy();
    await ready();
    fetchMock.mockResolvedValueOnce(new Response("login", { headers: { "content-type": "text/html" } }));
    await render().run("exportar");
    expect(render().download).toBeNull();
    expect(click).not.toHaveBeenCalled();
  });

  it("aborts slow requests and ignores their eventual completion", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = select().run("analisar");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(render().phase).toBe("idle");
    expect(render().error).toContain("mais tempo");
    resolve(Response.json(analysis));
    await pending;
    expect(render().analysis).toBeNull();
  });

  it("clears prior results after an invalid replacement", async () => {
    (await ready()).selectFile(new File(["x"], "invalid.csv"));
    expect(render().file).toBeNull();
    expect(render().analysis).toBeNull();
    expect(render().choices).toEqual([]);
    expect(render().error).toContain("XLSX");
  });
});
