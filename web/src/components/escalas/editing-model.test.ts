import { describe, expect, it } from "vitest";
import { visibleDates } from "@/lib/escalas/dates";
import { applyRosterChanges, inspectRosterChanges, isCurrentRosterChange, swapRosterDays } from "./roster-model";
import { changeBranchWeeklyHours, newEmployee, newInput } from "./workspace-model";

function sample() {
  const input = newInput("08", "Filial sintética", "2026-11", 40);
  input.employees = ["Ana", "Bruno"].map((name, index) => ({
    ...newEmployee(40, "turno-inicial"), id: String(index), registration: `00${index}`, name,
    sector: "Padaria", role: "Atendente", activeFrom: "2020-01-01",
  }));
  input.assignments = [
    { employeeId: "0", date: "2026-11-02", kind: "WORK", shiftId: "turno-inicial" },
    { employeeId: "1", date: "2026-11-02", kind: "OFF" },
  ];
  return input;
}

describe("monthly roster editing and operational feedback", () => {
  it("keeps the civil month visible and technical boundary days intact", () => {
    const input = sample();
    expect(input.visibleMonth).toBe("2026-11");
    expect(visibleDates(input)).toHaveLength(30);
    expect(visibleDates(input).at(0)).toBe("2026-11-01");
    expect(visibleDates(input).at(-1)).toBe("2026-11-30");
    expect(input.startDate).toBe("2026-10-26");
    expect(input.endDate).toBe("2026-12-06");
  });

  it("propagates a new branch target while preserving shorter and individual references", () => {
    const input = sample();
    input.defaultWeeklyHours = 44;
    input.employees = [
      { ...input.employees[0], weeklyHours: 44, weeklyHoursMode: "BRANCH" },
      { ...input.employees[1], weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL" },
      { ...input.employees[0], id: "short", registration: "short", weeklyHours: 40, weeklyHoursMode: undefined },
    ];
    const fortyTwo = changeBranchWeeklyHours(input, 42);
    expect(fortyTwo.employees.map((person) => person.weeklyHours)).toEqual([42, 40, 40]);
    const forty = changeBranchWeeklyHours(fortyTwo, 40);
    expect(forty.employees.map((person) => person.weeklyHours)).toEqual([40, 40, 40]);
    expect(changeBranchWeeklyHours(forty, 44).employees.map((person) => person.weeklyHours)).toEqual([44, 40, 40]);
    expect(input.employees[0].weeklyHours).toBe(44);
  });

  it("swaps a rest and workday without changing the source or unrelated assignments", () => {
    const input = sample();
    const next = swapRosterDays(input, { employeeId: "0", date: "2026-11-02" }, { employeeId: "1", date: "2026-11-02" });
    expect(next.assignments).toContainEqual({ employeeId: "0", date: "2026-11-02", kind: "OFF", locked: true });
    expect(next.assignments).toContainEqual({ employeeId: "1", date: "2026-11-02", kind: "WORK", shiftId: "turno-inicial", locked: true });
    expect(input.assignments[0].kind).toBe("WORK");
    expect(input.assignments[1].kind).toBe("OFF");
  });

  it("refuses locked or incompatible swaps instead of silently overriding a decision", () => {
    const input = sample();
    input.assignments[0].locked = true;
    expect(() => swapRosterDays(input, { employeeId: "0", date: "2026-11-02" }, { employeeId: "1", date: "2026-11-02" })).toThrow("bloqueada");
    input.assignments[0].locked = false;
    input.employees[1].shiftIds = [];
    expect(() => swapRosterDays(input, { employeeId: "0", date: "2026-11-02" }, { employeeId: "1", date: "2026-11-02" })).toThrow("horário permitido");
  });

  it("preserves absences instead of transferring them in a shift or rest exchange", () => {
    const input = sample();
    input.assignments[1] = { employeeId: "1", date: "2026-11-02", kind: "ABSENCE" };
    expect(() => swapRosterDays(input, { employeeId: "0", date: "2026-11-02" }, { employeeId: "1", date: "2026-11-02" })).toThrow("Ausências não são transferidas");
    expect(input.assignments[1].kind).toBe("ABSENCE");
  });

  it("requires approval to unlock and a separate operation before modifying a locked day", () => {
    const input = sample();
    input.assignments[0].locked = true;
    const unlocked = { ...input.assignments[0], locked: false };
    expect(() => applyRosterChanges(input, [unlocked])).toThrow("bloqueada");
    expect(applyRosterChanges(input, [unlocked], true).assignments[0].locked).toBe(false);
    expect(() => applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "OFF", locked: false }], true)).toThrow("bloqueada");
  });

  it("does not invent a clock schedule when editing an employee with missing imported hours", () => {
    const input = sample();
    input.employees[0].scheduleMode = "MISSING";
    input.employees[0].shiftIds = [];
    expect(() => applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "WORK", shiftId: "turno-inicial" }])).toThrow("sem horário");
    const next = applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "DUTY", locked: true }]);
    expect(next.assignments.find((item) => item.employeeId === "0")?.kind).toBe("DUTY");
  });

  it("previews actual coverage loss for the changed day before confirming an edit", () => {
    const input = sample();
    input.demands = [{ id: "required", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 1 }];
    const next = applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "OFF", locked: true }]);
    const impact = inspectRosterChanges(input, next);
    expect(impact.coverageIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "COVERAGE_DEFICIT", date: "2026-11-02" })]));
    expect(impact.newErrors.some((issue) => issue.code === "COVERAGE_DEFICIT")).toBe(true);
    expect(impact.coverageIssues[0].message).toContain("0 presente(s)");
    expect(impact.coverageIssues[0].message).toContain("mínimo 1");
  });

  it("keeps estimates separate from mandatory minima in an edit preview", () => {
    const input = sample();
    input.policy.coverageReview = "SUGGESTED";
    input.demands = [{ id: "estimated", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 1, estimated: true }];
    const next = applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "OFF" }]);
    const impact = inspectRosterChanges(input, next);
    expect(impact.coverageIssues[0]).toMatchObject({ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING" });
    expect(impact.newErrors.some((issue) => issue.code === "ESTIMATED_COVERAGE_GAP")).toBe(false);
  });
  it("keeps undo valid when the workspace only stamps regeneration metadata", () => {
    const input = sample();
    const applied = applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "OFF" }]);
    expect(isCurrentRosterChange(applied, applied)).toBe(true);
    expect(isCurrentRosterChange(applied, { ...applied, needsRegeneration: false })).toBe(true);
    const absence = applyRosterChanges(input, [{ employeeId: "0", date: "2026-11-02", kind: "ABSENCE" }]);
    expect(isCurrentRosterChange(absence, { ...absence, needsRegeneration: true })).toBe(true);
  });
  it("invalidates undo after reload, another assignment or any scenario definition change", () => {
    const applied = sample();
    expect(isCurrentRosterChange(applied, JSON.parse(JSON.stringify(applied)))).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, assignments: [...applied.assignments] })).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, employees: [...applied.employees] })).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, shifts: [...applied.shifts] })).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, policy: { ...applied.policy } })).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, demands: [...applied.demands] })).toBe(false);
    expect(isCurrentRosterChange(applied, { ...applied, branchName: "Outro planejamento" })).toBe(false);
  });

});
