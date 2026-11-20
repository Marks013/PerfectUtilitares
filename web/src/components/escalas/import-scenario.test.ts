import { describe, expect, it } from "vitest";
import type { EscalaInput } from "@/lib/escalas/types";
import { employeeImportScenarioKey } from "./coverage-import";
import { newEmployee, newInput } from "./workspace-model";

describe("employee import review identity", () => {
  it("invalidates review when interpretation, team decisions or references change", () => {
    const input = newInput("06", "Synthetic", "2026-12", 42);
    input.employees = [{ ...newEmployee(42), id: "synthetic", registration: "0001" }];
    const original = structuredClone(input), key = employeeImportScenarioKey(input);
    const changes: Partial<EscalaInput>[] = [
      { branchCode: "07" }, { startDate: "2026-12-06" }, { endDate: "2027-01-09" },
      { visibleMonth: "2027-01" }, { planningWeekStartsOn: "MONDAY" }, { defaultWeeklyHours: 40 },
      { employees: input.employees.map(person => ({ ...person, registration: "0002" })) },
      { employees: input.employees.map(person => ({ ...person, fixedOffDays: [2], offMode: "MIXED" })) },
      { shifts: input.shifts.map(shift => ({ ...shift, name: "New reviewed reference" })) },
    ];
    for (const change of changes) expect(employeeImportScenarioKey({ ...input, ...change })).not.toBe(key);
    expect(input).toEqual(original);
  });

  it("allows new protected days and operational targets to be reconciled against the latest input", () => {
    const input = newInput("06", "Synthetic", "2026-12", 42);
    const next: EscalaInput = { ...input,
      assignments: [{ employeeId: "synthetic", date: "2026-12-01", kind: "OFF", locked: true }],
      demands: [{ id: "synthetic-target", date: "2026-12-01", sector: "Store", start: 480, end: 600, minimum: 1 }],
    };
    expect(employeeImportScenarioKey(next)).toBe(employeeImportScenarioKey(input));
    expect(next.assignments[0].locked).toBe(true);
  });
});
