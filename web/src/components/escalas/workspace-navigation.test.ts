import { describe, expect, it } from "vitest";
import { pendingNavigation } from "./workspace-navigation";

describe("planning navigation with unapplied work", () => {
  it("intercepts an unapplied candidate even when the current grade is already saved", () => {
    expect(pendingNavigation(false, true, false)).toBe(true);
    expect(pendingNavigation(true, true, false)).toBe(true);
    expect(pendingNavigation(true, false, false)).toBe(true);
    expect(pendingNavigation(false, false, false)).toBe(false);
    expect(pendingNavigation(false, true, true)).toBe(false);
  });
});
