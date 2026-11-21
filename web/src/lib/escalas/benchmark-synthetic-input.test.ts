import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "./schema";
import { fingerprintSyntheticRoster, requireSharedSyntheticSeed, syntheticInput } from "../../../scripts/escalas/benchmark-synthetic";
import { benchmarkPython } from "../../../scripts/escalas/benchmark-runtime";

describe("synthetic solver benchmark calendar", () => {
  it("fingerprints only the FIRST feasible roster, never the refined final output", () => {
    // Mock CP-SAT imports so we can execute the exact Python benchmark wrapper
    // without external dependencies, databases or any real scheduling input.
    const shim = String.raw`
import sys, types
for name in ("ortools", "ortools.sat", "ortools.sat.python"):
    module = types.ModuleType(name)
    module.__path__ = []
    sys.modules[name] = module
cp_module = types.ModuleType("ortools.sat.python.cp_model")
class FakeCpSolver:
    def solve(self, _model): return 4
    def status_name(self, _status): return "FEASIBLE"
cp_module.CpSolver = FakeCpSolver
sys.modules[cp_module.__name__] = cp_module
sys.modules["ortools.sat.python"].cp_model = cp_module
`;
    const solverSource = String.raw`
def _read_assignments(stage):
    return [{"employeeId": "synthetic", "date": "2026-12-06", "kind": stage}]
def solve(_data):
    _read_assignments("OFF")
    _read_assignments("WORK")  # Simulates the later, refined schedule.
    return {"status": "FEASIBLE"}
`;
    const outcome = spawnSync("python3", ["-c", shim + "\n" + benchmarkPython], {
      encoding: "utf8", timeout: 5000,
      input: JSON.stringify({ sources: { solver: solverSource }, resources: {}, input: {}, pairedSeed: true }),
    });
    expect(outcome.status).toBe(0);
    const actual = JSON.parse(outcome.stdout) as { initialSeedHash: string };
    expect(actual.initialSeedHash).toBe("cf4470587529a841001d067d0c89646fa3f6b92d2bb223492c2a4a32ee16e9b3");
  });


  it("fingerprints the FINAL reused roster with the same canonical SHA-256 as Python", () => {
    const finalRoster = [
      { employeeId: "person-2", date: "2026-11-01", kind: "WORK" as const, shiftId: "reference" },
      { employeeId: "person-1", date: "2026-11-01", kind: "OFF" as const },
    ];
    const finalHash = fingerprintSyntheticRoster(finalRoster);
    expect(finalHash).toBe("28cb0fde732801582652cd1348caf86e840245d73617aebbe358cadc6b98a559");
    expect(fingerprintSyntheticRoster([...finalRoster].reverse())).toBe(finalHash);
    const initialHash = fingerprintSyntheticRoster([
      { employeeId: "person-2", date: "2026-11-01", kind: "OFF" as const },
      finalRoster[1],
    ]);
    expect(initialHash).not.toBe(finalHash);
    expect(() => requireSharedSyntheticSeed(finalHash, initialHash)).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
  });

  it("rejects missing, invalid or divergent accepted synthetic seed fingerprints", () => {
    const seed = "a".repeat(64);
    expect(() => requireSharedSyntheticSeed(seed, seed)).not.toThrow();
    expect(() => requireSharedSyntheticSeed(seed, "b".repeat(64))).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
    expect(() => requireSharedSyntheticSeed(seed, undefined)).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
    expect(() => requireSharedSyntheticSeed("invalid", "invalid")).toThrow("BENCHMARK_SHARED_SEED_DIVERGED");
  });

  it("keeps one synthetic sector with distinct role cohorts across four Sundays", () => {
    const input = syntheticInput({ id: "team-12-four-weeks", people: 12, weeks: 4 });
    expect(input.employees).toHaveLength(12);
    expect(new Set(input.employees.map(person => person.sector)).size).toBe(1);
    expect(input.employees.filter(person => person.role === "Encarregado")).toHaveLength(1);
    expect(input.employees.filter(person => person.role === "Repositor")).toHaveLength(11);
    expect(input.employees.every(person => person.scheduleMode === "TIMED")).toBe(true);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ["team-10-week", 10, 1, "2026-11-07"],
    ["team-12-four-weeks", 12, 4, "2026-11-28"],
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
  it("keeps synthetic managers and supervisors untimed without fixed weekend rest", () => {
    const input = syntheticInput({
      id: "branch-115-six-weeks-untimed", people: 115, weeks: 6, untimedLeaders: true,
    });
    const leaders = input.employees.filter((person) => person.role === "Gerente" || person.role === "Encarregado");
    expect(input.endDate).toBe("2026-12-12");
    expect(input.employees).toHaveLength(115);
    expect(leaders).toHaveLength(10);
    expect(leaders.some((person) => person.role === "Gerente")).toBe(true);
    for (const leader of leaders) {
      expect(leader.scheduleMode).toBe("UNTIMED");
      expect(leader.shiftIds).toEqual([]);
      expect(leader.sourceSchedule).toBeUndefined();
      expect(leader.fixedOffDays).toEqual([]);
      expect(leader.offMode).toBe("VARIABLE");
    }
    expect(input.employees.filter((person) => person.scheduleMode === "TIMED")).toHaveLength(105);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });
});
