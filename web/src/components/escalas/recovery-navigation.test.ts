import { describe, expect, it, vi } from "vitest";
import { recoveryArea, revealRecoveryTarget } from "./recovery-navigation";

function node(tagName: string, parentElement: HTMLElement | null = null) {
  return { tagName, parentElement, open: false, scrollIntoView: vi.fn(), focus: vi.fn(), querySelector: vi.fn(() => null as HTMLElement | null) };
}
function documentWith(entries: Record<string, ReturnType<typeof node>>) {
  return { getElementById: (id: string) => (entries[id] ?? null) as unknown as HTMLElement | null };
}

describe("recovery navigation after the destination is mounted", () => {
  it("opens team restrictions and focuses the actual review instead of the area heading", () => {
    const heading = node("DIV");
    const details = node("DETAILS");
    const review = node("DIV", details as unknown as HTMLElement);
    expect(revealRecoveryTarget("team", documentWith({ "escala-team": heading, "escala-team-review": review }))).toBe(true);
    expect(details.open).toBe(true);
    expect(review.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(heading.focus).not.toHaveBeenCalled();
  });
  it("does not pretend navigation succeeded before the destination exists", () => {
    const entries: Record<string, ReturnType<typeof node>> = {};
    const document = documentWith(entries);
    expect(revealRecoveryTarget("coverage", document)).toBe(false);
    const details = node("DETAILS"), summary = node("SUMMARY", details as unknown as HTMLElement);
    details.querySelector.mockReturnValue(summary as unknown as HTMLElement);
    entries["escala-coverage-required"] = details;
    expect(revealRecoveryTarget("coverage", document)).toBe(true);
    expect(details.open).toBe(true);
    expect(summary.focus).toHaveBeenCalled();
  });
  it("opens the same destination again after the user closes it", () => {
    const details = node("DETAILS"), summary = node("SUMMARY", details as unknown as HTMLElement);
    details.querySelector.mockReturnValue(summary as unknown as HTMLElement);
    const document = documentWith({ "escala-coverage-required": details });
    expect(revealRecoveryTarget("coverage", document)).toBe(true);
    details.open = false;
    expect(revealRecoveryTarget("coverage", document)).toBe(true);
    expect(details.open).toBe(true);
    expect(summary.focus).toHaveBeenCalledTimes(2);
  });
  it("waits for the exact editor rather than claiming a generic section is the correction", () => {
    const entries: Record<string, ReturnType<typeof node>> = { "escala-team-review": node("DIV") };
    expect(revealRecoveryTarget("team", documentWith(entries), { employeeId: "person-1" })).toBe(false);
    expect(entries["escala-team-review"].focus).not.toHaveBeenCalled();
    entries["escala-employee-editor"] = node("FORM");
    expect(revealRecoveryTarget("team", documentWith(entries), { employeeId: "person-1" })).toBe(true);
    expect(entries["escala-employee-editor"].focus).toHaveBeenCalled();
  });
  it("reveals the short-meal option and the exact coverage workspace", () => {
    const intervals = node("DETAILS"), timeline = node("SECTION");
    const doc = documentWith({ "escala-short-meal": intervals, "escala-coverage-timeline": timeline });
    expect(revealRecoveryTarget("intervals", doc)).toBe(true);
    expect(intervals.open).toBe(true);
    expect(recoveryArea("intervals")).toBe("adjustments");
    expect(revealRecoveryTarget("coverage", doc, { sector: "Caixas", date: "2026-11-02", start: 450 })).toBe(true);
    expect(timeline.focus).toHaveBeenCalled();
  });
  it("opens editable mandatory minima when only sector and date identify the conflict", () => {
    const details = node("DETAILS"), timeline = node("SECTION"), summary = node("SUMMARY");
    details.querySelector.mockReturnValue(summary as unknown as HTMLElement);
    const doc = documentWith({ "escala-coverage-required": details, "escala-coverage-timeline": timeline });
    expect(revealRecoveryTarget("coverage", doc, { sector: "Loja", date: "2026-11-02" })).toBe(true);
    expect(details.open).toBe(true);
    expect(summary.focus).toHaveBeenCalled();
    expect(timeline.focus).not.toHaveBeenCalled();
  });
  it("opens the real roster instead of silently switching to adjustments", () => {
    expect(recoveryArea("roster")).toBe("roster");
    expect(recoveryArea("rules")).toBe("adjustments");
    expect(recoveryArea("team")).toBe("team");
    expect(recoveryArea("coverage")).toBe("coverage");
  });
});
