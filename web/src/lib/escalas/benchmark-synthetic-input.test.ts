import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "./schema";
import { fingerprintSyntheticRoster, requireSharedSyntheticSeed, syntheticInput } from "../../../scripts/escalas/benchmark-synthetic";

describe("synthetic solver benchmark calendar", () => {
  it("fingerprints the FINAL reused roster with the same canonical SHA-256 as Python", () => {
    const finalRoster = [
      { employeeId: "person-2", date: "2026-11-01", kind: "WORK" as const, shiftId: "reference" },
      { employeeId: "person-1", date: "2026-11-01", kind: "OFF" as const },
    ];
    const finalHash = fingerprintSyntheticRoster(finalRoster);
    expect(finalHash).toBe("28cb0fde732801582652cd1348caf86e840245d73617aebbe358cadc6b98a559");
    expect(fingerprintSyntheticRoster([...finalRoster].reverse())).toBe(finalHash);
    const initialRoster = [
      { employeeId: "person-2", date: "2026-11-01", kind: "OFF" as const },
      finalRoster[1],
    ];
    const initialHash = fingerprintSyntheticRoster(initialRoster);
    expect(initialHash).not.toBe(finalHash);
    expect(() => requireSharedSyntheticSeed(finalHash, initialHash)).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
    expect(() => requireSharedSyntheticSeed(finalHash, finalHash)).not.toThrow();
  });

  it("requires identical accepted synthetic seed fingerprints", () => {
    const seed = "a".repeat(64);
    expect(() => requireSharedSyntheticSeed(seed, seed)).not.toThrow();
    expect(() => requireSharedSyntheticSeed(seed, "b".repeat(64))).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
    expect(() => requireSharedSyntheticSeed(seed, undefined)).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
    expect(() => requireSharedSyntheticSeed("unverified", "unverified")).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
  });

  it.each([
    ["team-10-week", 10, 1, "2026-11-07"],
    ["branch-50-four-weeks", 50, 4, "2026-11-28"],
    ["branch-115-six-weeks", 115, 6, "2026-12-12"],
  ] as const)("creates a complete Sunday-Saturday scenario for %s", (id, people, weeks, endDate) => {
    const input = syntheticInput({ id, people, weeks });
    expect(input.startDate).toBe("2026-11-01");
    expect(input.endDate).toBe(endDate);
    expect(input.planningWeekStartsOn).toBe("SUNDAY");
    expect(input.employees).toHaveLength(people);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(input.visibleMonth).toBeUndefined();
    expect(input.assignments).toEqual([]);
  });
});
