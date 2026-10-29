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
  it("opens the real roster instead of silently switching to adjustments", () => {
    expect(recoveryArea("roster")).toBe("roster");
    expect(recoveryArea("rules")).toBe("adjustments");
    expect(recoveryArea("team")).toBe("team");
    expect(recoveryArea("coverage")).toBe("coverage");
  });
});
