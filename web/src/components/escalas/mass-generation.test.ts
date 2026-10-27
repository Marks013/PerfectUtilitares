import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { requestMassGeneration, type GeneratedProposal } from "./mass-generation";
import { newInput } from "./workspace-model";

function fixture() {
  const input = newInput("08", "Filial", "2026-11", 42);
  const validation = { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null };
  const workspace: EscalaWorkspace = { id: "plan", revision: 2, status: "DRAFT", input, validation, canEdit: true, canPublish: true, updatedAt: "2026-10-27T12:00:00Z" };
  const saved = { ...workspace, revision: 3 };
  const proposal: GeneratedProposal = { result: { status: "FEASIBLE", assignments: [], message: "Rascunho", wallTimeSeconds: 1 }, proposalInput: input, validation };
  const signal = new AbortController().signal;
  const onSaved = vi.fn();
  const onSolving = vi.fn();
  const isCurrent = vi.fn(() => true);
  return { input, workspace, saved, proposal, signal, onSaved, onSolving, isCurrent };
}

describe("branch-wide generation request sequence", () => {
  it("saves the selected hours once, solves the returned revision and leaves preview application explicit", async () => {
    const value = fixture();
    const post = vi.fn().mockResolvedValueOnce(value.saved).mockResolvedValueOnce(value.proposal);
    const result = await requestMassGeneration({ ...value, dirty: true, post });
    expect(post.mock.calls.map(([body]) => body.action)).toEqual(["SAVE", "GENERATE"]);
    expect(post.mock.calls[0][0]).toMatchObject({ id: "plan", expectedRevision: 2, input: value.input });
    expect(post.mock.calls[1][0]).toEqual({ action: "GENERATE", id: "plan", expectedRevision: 3 });
    expect(value.onSaved).toHaveBeenCalledExactlyOnceWith(value.saved);
    expect(value.onSolving).toHaveBeenCalledOnce();
    expect(result).toBe(value.proposal);
    expect(post.mock.calls.some(([body]) => body.action === "PUBLISH")).toBe(false);
  });

  it("does not create another revision when the selected hours are already saved", async () => {
    const value = fixture();
    const post = vi.fn().mockResolvedValue(value.proposal);
    await requestMassGeneration({ ...value, dirty: false, post });
    expect(post).toHaveBeenCalledExactlyOnceWith({ action: "GENERATE", id: "plan", expectedRevision: 2 }, value.signal);
    expect(value.onSaved).not.toHaveBeenCalled();
  });

  it("stops before generation when saving fails, preserving the conflict for the interface", async () => {
    const value = fixture();
    const post = vi.fn().mockRejectedValue(new Error("A versão da proposta mudou."));
    await expect(requestMassGeneration({ ...value, dirty: true, post })).rejects.toThrow("A versão da proposta mudou.");
    expect(post).toHaveBeenCalledOnce();
    expect(value.onSaved).not.toHaveBeenCalled();
    expect(value.onSolving).not.toHaveBeenCalled();
  });

  it("ignores a late saved response after switching or unmounting, without launching the optimizer", async () => {
    const value = fixture();
    let current = true;
    const post = vi.fn().mockImplementation(async () => { current = false; return value.saved; });
    expect(await requestMassGeneration({ ...value, dirty: true, post, isCurrent: () => current })).toBeNull();
    expect(post).toHaveBeenCalledOnce();
    expect(value.onSaved).not.toHaveBeenCalled();
    expect(value.onSolving).not.toHaveBeenCalled();
  });

  it("ignores a late successful solve after cancellation and never applies assignments", async () => {
    const value = fixture();
    const controller = new AbortController();
    const post = vi.fn().mockImplementation(async () => { controller.abort(); return value.proposal; });
    expect(await requestMassGeneration({ ...value, dirty: false, post, signal: controller.signal })).toBeNull();
    expect(value.workspace.input.assignments).toEqual([]);
    expect(value.onSaved).not.toHaveBeenCalled();
  });

  it("does not issue any request for an already cancelled analysis", async () => {
    const value = fixture();
    const controller = new AbortController();
    controller.abort();
    const post = vi.fn();
    expect(await requestMassGeneration({ ...value, dirty: true, post, signal: controller.signal })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
