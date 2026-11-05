import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonBody, requireMaxContentLength } from "@/lib/api/security";
import { readMultipartBody } from "@/lib/api/multipart";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

afterEach(() => vi.useRealTimers());

function streamRequest(kind: "json" | "multipart", cancel = vi.fn()) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; },
    cancel,
  });
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": kind === "json" ? "application/json" : "multipart/form-data; boundary=test" },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, source, cancel };
}

function parse(kind: "json" | "multipart", request: Request, limit = 1024) {
  requireMaxContentLength(request, limit);
  return kind === "json" ? readJsonBody(request) : readMultipartBody(request, limit);
}

describe("request body stream safety", () => {
  it.each(["json", "multipart"] as const)("bounds idle %s reads and cancels the source", async (kind) => {
    vi.useFakeTimers();
    const { request, cancel } = streamRequest(kind);
    let settled = false;
    const pending = parse(kind, request).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(settled).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(408);
      expect(await result.response.json()).toMatchObject({ error: { code: "REQUEST_TIMEOUT" } });
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["json", "multipart"] as const)("does not let dripping %s extend the total budget", async (kind) => {
    vi.useFakeTimers();
    const { request, source } = streamRequest(kind);
    let settled = false;
    const pending = parse(kind, request).then((result) => { settled = true; return result; });
    for (let index = 0; index < 15; index += 1) {
      source.enqueue(new TextEncoder().encode(kind === "json" ? " " : "x"));
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(settled).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(408);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not await an uncooperative JSON cancellation or mask the size error", async () => {
    vi.useFakeTimers();
    const { request, source, cancel } = streamRequest("json", vi.fn(() => new Promise<void>(() => {})));
    source.enqueue(new TextEncoder().encode("0123456789"));
    let settled = false;
    const pending = parse("json", request, 4).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const result = await pending;
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("parses fragmented UTF-8 JSON without altering the data", async () => {
    const { request, source } = streamRequest("json");
    const bytes = new TextEncoder().encode(JSON.stringify({ nome: "João", setor: "Açougue" }));
    for (const byte of bytes) source.enqueue(Uint8Array.of(byte));
    source.close();
    expect(await parse("json", request)).toEqual({ ok: true, data: { nome: "João", setor: "Açougue" } });
  });

  it("parses a real multipart file and preserves its bytes", async () => {
    const form = new FormData();
    form.set("file", new File(["área;horário\nCaixa;08:00"], "equipe.csv", { type: "text/csv" }));
    const request = new Request("http://localhost/api/test", { method: "POST", body: form });
    const result = await readMultipartBody(request, 2048);
    expect(result.ok).toBe(true);
    if (result.ok) expect(await (result.data.get("file") as File).text()).toBe("área;horário\nCaixa;08:00");
  });
});
