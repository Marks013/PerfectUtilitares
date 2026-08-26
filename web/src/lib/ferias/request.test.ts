import { describe, expect, it } from "vitest";
import { FERIAS_MAX_BODY_BYTES, readFeriasRequest } from "@/lib/ferias/request";

function upload(fields?: Record<string, string | undefined>, name = "ferias.xlsx") {
  const form = new FormData();
  form.set("file", new File(["workbook"], name));
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) form.set(key, value);
  }
  return new Request("https://example.test/api/admin/ferias/analisar", { method: "POST", body: form });
}

describe("readFeriasRequest", () => {
  it("reads the original bytes and hashes them without trusting a filename", async () => {
    const result = await readFeriasRequest(upload({ choices: '[{"row":4,"holderId":"h1"}]' }), new AbortController().signal, false);
    expect(result.buffer.toString()).toBe("workbook");
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.choices).toEqual([{ row: 4, holderId: "h1" }]);
  });

  it("requires the analyzed revision for export", async () => {
    await expect(readFeriasRequest(upload(), new AbortController().signal, true)).rejects.toMatchObject({ code: "FERIAS_REVISION_INVALID" });
    const result = await readFeriasRequest(upload({ revision: "a".repeat(64) }), new AbortController().signal, true);
    expect(result.revision).toBe("a".repeat(64));
  });

  it.each([
    { choices: '[{"row":4,"holderId":"h1","amount":10}]' },
    { choices: '[{"row":4},{"row":4}]' },
    { choices: "null" },
    { tenantId: "other-tenant" },
  ])("rejects invalid or untrusted fields %j", async (fields) => {
    await expect(readFeriasRequest(upload(fields), new AbortController().signal, false)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects duplicate file fields", async () => {
    const form = new FormData();
    form.append("file", new File(["a"], "a.xlsx"));
    form.append("file", new File(["b"], "b.xlsx"));
    const request = new Request("https://example.test", { method: "POST", body: form });
    await expect(readFeriasRequest(request, request.signal, false)).rejects.toMatchObject({ code: "FERIAS_FORM_INVALID" });
  });

  it("rejects macros and malformed multipart", async () => {
    await expect(readFeriasRequest(upload({}, "ferias.xlsm"), new AbortController().signal, false)).rejects.toMatchObject({ code: "FERIAS_FILE_INVALID" });
    const request = new Request("https://example.test", { method: "POST", body: "bad", headers: { "content-type": "multipart/form-data; boundary=x" } });
    await expect(readFeriasRequest(request, request.signal, false)).rejects.toMatchObject({ code: "FERIAS_FORM_INVALID" });
  });

  it.each([undefined, "1"])("bounds actual streamed bytes with declared size %s", async (length) => {
    const headers: Record<string, string> = { "content-type": "multipart/form-data; boundary=x" };
    if (length) headers["content-length"] = length;
    const request = new Request("https://example.test", {
      method: "POST", headers,
      body: new Uint8Array(FERIAS_MAX_BODY_BYTES + 1),
    });
    await expect(readFeriasRequest(request, request.signal, false)).rejects.toMatchObject({ status: 413 });
  });

  it("cancels a stalled upload instead of leaving the reader running", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const request = new Request("https://example.test", {
      method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    const pending = readFeriasRequest(request, controller.signal, false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "FERIAS_CANCELLED" });
    expect(cancelled).toBe(true);
  });
});
