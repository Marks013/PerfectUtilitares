import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "./schema";
import { requireSharedSyntheticSeed, syntheticInput } from "../../../scripts/escalas/benchmark-synthetic";

describe("synthetic solver benchmark calendar", () => {
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
