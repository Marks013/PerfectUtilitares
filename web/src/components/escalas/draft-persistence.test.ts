import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { newInput } from "./workspace-model";
import { DraftSaveQueue, parseSavedWorkspace, sameDraft } from "./draft-persistence";
import { EscalaRequestError } from "./workspace-feedback-model";

function base(): EscalaWorkspace { return { id: "draft", revision: 3, input: newInput("02", "Loja", "2026-11", 42), status: "DRAFT", updatedAt: "2026-10-29T00:00:00Z", validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null }, canEdit: true, canPublish: false }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup(send = vi.fn(async (saved: EscalaWorkspace, input: EscalaWorkspace["input"]) => ({ ...saved, input, revision: saved.revision + 1 })), load = vi.fn(async () => base())) {
  const onSaved = vi.fn(), onState = vi.fn(); const queue = new DraftSaveQueue({ send, load, onSaved, onState }); queue.select(base()); return { queue, send, load, onSaved, onState };
}
describe("revision-aware draft save queue", () => {
  it("acknowledges a real save without publishing and makes concurrent callers share one write", async () => {
    const wait = deferred<EscalaWorkspace>(); const state = setup(vi.fn(() => wait.promise));
    const draft = { ...base().input, branchName: "Novo nome" }; state.queue.edit(draft);
    const first = state.queue.flush(), second = state.queue.flush();
    expect(state.send).toHaveBeenCalledTimes(1);
    wait.resolve({ ...base(), input: draft, revision: 4 });
    await Promise.all([first, second]);
    expect(state.queue.hasChanges).toBe(false); expect(state.onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "DRAFT", revision: 4 }), draft, false);
  });
  it("never replaces typing performed while a slow save is in flight, and saves next against the returned revision", async () => {
    const wait = deferred<EscalaWorkspace>(); const send = vi.fn().mockImplementationOnce(() => wait.promise).mockImplementation(async (saved, input) => ({ ...saved, input, revision: saved.revision + 1 })); const state = setup(send);
    const first = { ...base().input, branchName: "Primeiro" }, latest = { ...first, branchName: "Mais recente" };
    state.queue.edit(first); const pending = state.queue.flush(); state.queue.edit(latest);
    wait.resolve({ ...base(), input: first, revision: 4 }); await pending;
    expect(state.onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 4 }), latest, true);
    await state.queue.flush(); expect(send.mock.calls[1][0].revision).toBe(4); expect(send.mock.calls[1][1]).toBe(latest); expect(state.queue.hasChanges).toBe(false);
  });
  it("reads persisted content after a lost acknowledgement and does not repeat an already committed save", async () => {
    const draft = { ...base().input, branchName: "Persistido" }; const state = setup(vi.fn().mockRejectedValue(new TypeError("connection lost")), vi.fn(async () => ({ ...base(), revision: 4, input: draft })));
    state.queue.edit(draft); await state.queue.flush(); await state.queue.flush();
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.load).toHaveBeenCalledTimes(1); expect(state.queue.hasChanges).toBe(false);
  });
  it("requires reconciliation before retrying a write whose result and follow-up read were both lost", async () => {
    const draft = { ...base().input, branchName: "Incerto" }; const load = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({ ...base(), revision: 4, input: draft }); const state = setup(vi.fn().mockRejectedValue(new TypeError("offline")), load);
    state.queue.edit(draft); await expect(state.queue.flush()).rejects.toMatchObject({ code: "ESCALA_SAVE_UNCERTAIN" });
    state.queue.retry(); await state.queue.flush(); expect(state.send).toHaveBeenCalledTimes(1); expect(state.queue.hasChanges).toBe(false);
  });
  it("preserves the draft on external revision conflict and never auto-overwrites", async () => {
    const state = setup(vi.fn().mockRejectedValue(new EscalaRequestError("ESCALA_STALE_REVISION", 409, "Conflict")), vi.fn(async () => ({ ...base(), revision: 4, input: { ...base().input, branchName: "Outra pessoa" } })));
    state.queue.edit({ ...base().input, branchName: "Minha edição" }); await expect(state.queue.flush()).rejects.toMatchObject({ status: 409 });
    await expect(state.queue.flush()).rejects.toMatchObject({ status: 409 }); expect(state.send).toHaveBeenCalledTimes(1); expect(state.queue.hasChanges).toBe(true); expect(state.onSaved).not.toHaveBeenCalled();
  });
  it("does not apply an old response after another workspace is selected", async () => {
    const wait = deferred<EscalaWorkspace>(); const state = setup(vi.fn(() => wait.promise)); state.queue.edit({ ...base().input, branchName: "Antiga" }); const pending = state.queue.flush();
    state.queue.select({ ...base(), id: "different" }); wait.resolve({ ...base(), revision: 4 }); await pending; expect(state.onSaved).not.toHaveBeenCalled();
  });
  it("saves a newly selected workspace after an older workspace's slow write settles", async () => {
    const wait = deferred<EscalaWorkspace>(); const send = vi.fn().mockImplementationOnce(() => wait.promise).mockImplementation(async (saved, input) => ({ ...saved, input, revision: saved.revision + 1 })); const state = setup(send);
    state.queue.edit({ ...base().input, branchName: "A" }); const savingA = state.queue.flush();
    const second = { ...base(), id: "second", revision: 8 }; state.queue.select(second); const draftB = { ...second.input, branchName: "B" }; state.queue.edit(draftB); const savingB = state.queue.flush();
    wait.resolve({ ...base(), input: { ...base().input, branchName: "A" }, revision: 4 }); await Promise.all([savingA, savingB]);
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toMatchObject({ id: "second", revision: 8 });
    expect(state.onSaved).toHaveBeenCalledTimes(1); expect(state.onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: "second", revision: 9 }), draftB, false); expect(state.queue.hasChanges).toBe(false);
  });
  it("keeps incomplete or invalid fields out of persistence", async () => {
    const state = setup(); state.queue.edit({ ...base().input, branchName: "" }); await expect(state.queue.flush()).rejects.toMatchObject({ code: "ESCALA_INVALID_INPUT" }); expect(state.send).not.toHaveBeenCalled(); expect(state.queue.hasChanges).toBe(true);
  });
  it("rejects a malformed successful acknowledgement and reconciles before changing the UI", async () => {
    const state = setup(vi.fn().mockResolvedValue({}), vi.fn(async () => base())); state.queue.edit({ ...base().input, branchName: "Editar" });
    await expect(state.queue.flush()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(state.load).toHaveBeenCalledTimes(1); expect(state.onSaved).not.toHaveBeenCalled(); expect(state.queue.hasChanges).toBe(true);
    expect(() => parseSavedWorkspace({ id: "wrong", revision: 4 })).toThrow();
  });
  it("never equates different locks, absences or reference hours", () => {
    const first = base().input;
    expect(sameDraft(first, { ...first, defaultWeeklyHours: 40 })).toBe(false);
    expect(sameDraft(first, JSON.parse(JSON.stringify(first)))).toBe(true);
  });
});
