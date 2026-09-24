import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorPersistenceQueue, saveEditorDraft } from "./pdf-editor-persistence";

afterEach(() => vi.unstubAllGlobals());

describe("editor draft persistence", () => {
  it("serializes snapshots and waits for the final save before queueing export", async () => {
    const enqueue = createEditorPersistenceQueue();
    const events: string[] = [];
    let release!: () => void;
    const first = enqueue(async () => {
      events.push("old");
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const final = enqueue(async () => { events.push("latest"); });
    const exportJob = final.then(() => { events.push("export"); });
    await Promise.resolve();
    expect(events).toEqual(["old"]);
    release();
    await Promise.all([first, exportJob]);
    expect(events).toEqual(["old", "latest", "export"]);
  });

  it("allows retry after a network rejection", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const enqueue = createEditorPersistenceQueue();
    await expect(enqueue(() => saveEditorDraft("draft", "old")))
      .rejects.toThrow("Tente novamente");
    await expect(enqueue(() => saveEditorDraft("draft", "latest")))
      .resolves.toBeUndefined();
    expect(fetch.mock.calls[1][1].body).toBe("latest");
  });

  it("surfaces a 401 failure and does not queue an export", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Sessão expirada" } }), { status: 401 },
    )));
    const queueExport = vi.fn();
    await expect(saveEditorDraft("draft", "{}").then(queueExport))
      .rejects.toThrow("Sessão expirada");
    expect(queueExport).not.toHaveBeenCalled();
  });
});
