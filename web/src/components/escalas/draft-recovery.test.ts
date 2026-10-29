import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { newInput } from "./workspace-model";
import { clearRecovery, readRecovery, saveRecovery } from "./draft-recovery";

const workspace: EscalaWorkspace = { id: "recovery", revision: 3, status: "DRAFT", input: newInput("02", "Loja", "2026-11", 42), validation: { valid: true, readyToPublish: false, summaries: [], issues: [], minimumCoverageMargin: null }, canEdit: true, canPublish: false, updatedAt: "2026-10-29T00:00:00Z" };
describe("session-only draft recovery", () => {
  let values: Map<string, string>;
  beforeEach(() => { values = new Map(); vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); });
  afterEach(() => vi.unstubAllGlobals());
  it("restores the actual unsaved content and base revision without overwriting server content", () => {
    const draft = { ...workspace.input, branchName: "Minha edição" };
    expect(saveRecovery(workspace, draft)).toBe(true); expect(readRecovery(workspace)).toMatchObject({ baseRevision: 3, input: draft });
    expect(workspace.input.branchName).toBe("Loja");
  });
  it("clears an already committed draft instead of replaying the same save", () => {
    saveRecovery(workspace, workspace.input); expect(readRecovery(workspace)).toBeNull(); expect(values.size).toBe(0);
  });
  it("does not restore another branch, invalid JSON or expired data", () => {
    saveRecovery(workspace, { ...workspace.input, branchCode: "other" }); expect(readRecovery(workspace)).toBeNull();
    const key = [...values.keys()][0]; values.set(key, "not-json"); expect(readRecovery(workspace)).toBeNull();
    values.set(key, JSON.stringify({ baseRevision: 3, input: { ...workspace.input, branchName: "Antiga" }, savedAt: Date.now() - 9 * 60 * 60_000 }));
    expect(readRecovery(workspace)).toBeNull(); expect(values.size).toBe(0);
  });
  it("reports unavailable browser storage without preventing safe server saving", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("quota"); } }); expect(saveRecovery(workspace, workspace.input)).toBe(false); expect(() => clearRecovery(workspace.id)).not.toThrow();
  });
});
