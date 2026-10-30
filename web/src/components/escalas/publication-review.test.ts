import { describe, expect, it } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { newInput } from "./workspace-model";
import { isReviewedRevisionCurrent, type ReviewedRevision } from "./publication-review";
import { inactiveViewPropsEqual } from "./view-activity";

const workspace: EscalaWorkspace = { id: "plan", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-30", input: newInput("08", "Teste", "2026-11", 42), validation: { valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null } };
const review: ReviewedRevision = { workspaceId: workspace.id, revision: workspace.revision, input: workspace.input };
describe("revision-specific publication acknowledgement", () => {
  it("accepts only the exact clean saved revision", () => {
    expect(isReviewedRevisionCurrent(review, workspace, false, false)).toBe(true);
    expect(isReviewedRevisionCurrent(null, workspace, false, false)).toBe(false);
    expect(isReviewedRevisionCurrent(review, { ...workspace, revision: 4 }, false, false)).toBe(false);
    expect(isReviewedRevisionCurrent(review, { ...workspace, id: "other" }, false, false)).toBe(false);
  });
  it("rejects changed content, unsaved edits and outdated scenarios", () => {
    expect(isReviewedRevisionCurrent(review, { ...workspace, input: structuredClone(workspace.input) }, false, false)).toBe(false);
    expect(isReviewedRevisionCurrent(review, workspace, true, false)).toBe(false);
    expect(isReviewedRevisionCurrent(review, workspace, false, true)).toBe(false);
  });
  it("renders both activation transitions and skips only subsequent inactive updates", () => {
    expect(inactiveViewPropsEqual({ active: true }, { active: false })).toBe(false);
    expect(inactiveViewPropsEqual({ active: false }, { active: true })).toBe(false);
    expect(inactiveViewPropsEqual({ active: true }, { active: true })).toBe(false);
    expect(inactiveViewPropsEqual({ active: false }, { active: false })).toBe(true);
  });
});
