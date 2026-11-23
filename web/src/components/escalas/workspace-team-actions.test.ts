import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { operationalCommand } from "./operational-client";
import { workspaceTeamActions } from "./workspace-team-actions";

vi.mock("./operational-client", () => ({ operationalCommand: vi.fn() }));

const target = { id: "plan", revision: 4 };
const result = { ...target, revision: 5 } as EscalaWorkspace;
const range = { employeeId: "person", startDate: "2026-12-01", endDate: "2026-12-03" };

function setup() {
  const signal = new AbortController().signal;
  let current: typeof target | null = target;
  const flushDraft = vi.fn();
  const acceptWorkspace = vi.fn();
  const setNotice = vi.fn();
  const actions = workspaceTeamActions({
    workspaceId: target.id, canCreate: false, canChangeTeam: false,
    absenceTarget: () => current, flushDraft, acceptWorkspace, setNotice,
    run: async (_label, operation) => { await operation(signal, () => true); },
  });
  return { ...actions, signal, flushDraft, acceptWorkspace, setNotice, setCurrent: (value: typeof target | null) => { current = value; } };
}

describe("revisioned manual absence actions", () => {
  it("uses the saved revision, never autosaves edits and accepts a confirmed response", async () => {
    const state = setup();
    vi.mocked(operationalCommand).mockResolvedValueOnce(result);
    expect(await state.changeAbsence({ action: "ADD_ABSENCE", ...range })).toBe(true);
    expect(operationalCommand).toHaveBeenLastCalledWith({ action: "ADD_ABSENCE", ...range, id: target.id, expectedRevision: target.revision }, state.signal);
    expect(state.acceptWorkspace).toHaveBeenCalledWith(result);
    expect(state.flushDraft).not.toHaveBeenCalled();
    expect(state.setNotice).toHaveBeenCalledWith(expect.stringContaining("próxima geração"));
  });

  it("does not start without the editable revision and ignores a response after a context change", async () => {
    const state = setup();
    const command = { action: "REMOVE_ABSENCE" as const, ...range };
    vi.mocked(operationalCommand).mockClear();
    state.setCurrent(null);
    expect(await state.changeAbsence(command)).toBe(false);
    expect(operationalCommand).not.toHaveBeenCalled();
    state.setCurrent(target);
    vi.mocked(operationalCommand).mockImplementationOnce(async () => { state.setCurrent({ ...target, revision: 6 }); return result; });
    expect(await state.changeAbsence(command)).toBe(false);
    expect(state.acceptWorkspace).not.toHaveBeenCalled();
    expect(state.setNotice).not.toHaveBeenCalled();
  });
});
