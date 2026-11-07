import { describe, expect, it, vi } from "vitest";
import { refineRoster } from "./roster-refinement";
import { validateEscala } from "./validation";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "08", branchName: "Teste", startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Conferência de teste", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: true, reviewedBy: "Responsável de teste", weeklyLimit: 44,
      dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
      closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: ["p1", "p2"].map(id => ({ id, name: id, registration: id, sector: "Loja", role: "Repositor", weeklyHours: 42, shiftIds: ["day"], activeFrom: "2020-01-01",
      offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE", preferredOffDays: [], historyKnown: false, history: [] })),
    shifts: [{ id: "day", name: "Referência", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
    assignments: ["p1", "p2"].flatMap(employeeId => Array.from({ length: 7 }, (_, index) => {
      const work = employeeId === "p1" ? [0, 2, 3, 4, 5].includes(index) : index < 5;
      return { employeeId, date: `2026-11-${String(index + 2).padStart(2, "0")}`, kind: work ? "WORK" as const : "OFF" as const,
        ...(work ? { shiftId: "day" } : {}), locked: employeeId === "p2" || ![1, 2].includes(index) };
    })),
    demands: ["2026-11-03", "2026-11-04"].flatMap((date, index) => [{ id: `${date}a`, date, sector: "Loja", start: 480, end: 720, minimum: index ? 1 : 2, estimated: true },
      { id: `${date}b`, date, sector: "Loja", start: 780, end: 1044, minimum: index ? 1 : 2, estimated: true }]),
  };
}

describe("bounded roster refinement against fixed staffing references", () => {
  it("keeps the original when the monotonic preparation budget expires", () => {
    const input = fixture(), original = structuredClone(input);
    expect(refineRoster(input, 0)).toBe(input);
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(2000);
    try { expect(refineRoster(input)).toBe(input); } finally { clock.mockRestore(); }
    expect(input).toEqual(original);
  });
  it("exchanges one unlocked weekday pair, keeps the exact clock and demand, and passes the independent verifier", () => {
    const input = fixture(), before = structuredClone(input);
    expect(validateEscala(input).valid).toBe(true);
    const refined = refineRoster(input);
    expect(refined).not.toBe(input);
    expect(refined.assignments.filter((assignment, index) => assignment !== input.assignments[index])).toHaveLength(2);
    expect(refined.assignments.find(a => a.employeeId === "p1" && a.date === "2026-11-03")).toMatchObject({ kind: "WORK", shiftId: "day", locked: false });
    expect(refined.assignments.find(a => a.employeeId === "p1" && a.date === "2026-11-04")).toMatchObject({ kind: "OFF", locked: false });
    expect(refined.demands).toBe(input.demands); expect(refined.employees).toBe(input.employees); expect(refined.shifts).toBe(input.shifts);
    expect(validateEscala(refined).valid).toBe(true);
    expect(refineRoster(input)).toEqual(refined);
    expect(input).toEqual(before);
  });
  it.each(["locked-work", "locked-off", "absence", "fixed-day", "fixed-mode", "closed-day"])("preserves explicit restrictions: %s", restriction => {
    const input = fixture(), person = input.employees[0];
    const off = input.assignments.find(a => a.employeeId === "p1" && a.date === "2026-11-03");
    const work = input.assignments.find(a => a.employeeId === "p1" && a.date === "2026-11-04");
    if (!off || !work) throw new Error("Fixture pair missing");
    if (restriction === "locked-work") work.locked = true;
    if (restriction === "locked-off") off.locked = true;
    if (restriction === "absence") off.kind = "ABSENCE";
    if (restriction === "fixed-day") { person.offMode = "MIXED"; person.fixedOffDays = [1]; }
    if (restriction === "fixed-mode") { person.offMode = "FIXED"; person.fixedOffDays = [1, 6]; }
    if (restriction === "closed-day") { input.policy.closedDates = [off.date]; input.assignments = input.assignments.map(a => a.date === off.date ? { employeeId: a.employeeId, date: a.date, kind: "OFF", locked: true } : a); }
    expect(refineRoster(input)).toBe(input);
  });
  it("does not create an empty sector day even when that day's estimate is zero", () => {
    const input = fixture(); input.employees = input.employees.slice(0, 1); input.assignments = input.assignments.filter(a => a.employeeId === "p1");
    input.demands.filter(d => d.date === "2026-11-04").forEach(d => { d.minimum = 0; });
    expect(validateEscala(input).valid).toBe(true);
    expect(refineRoster(input)).toBe(input);
  });
  it("rejects a cheaper pair when it would break the consecutive-work limit across known prior days", () => {
    const input = fixture();
    input.employees[0].history = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map(date => ({ employeeId: "p1", date, kind: "WORK", shiftId: "day" }));
    expect(validateEscala(input).valid).toBe(true);
    expect(refineRoster(input)).toBe(input);
  });
  it("never shifts a shortage into another role merely to improve a sector-wide count", () => {
    const input = fixture(); input.employees[1].role = "Gerente";
    input.demands.filter(d => d.date === "2026-11-04").forEach(d => { d.role = "Repositor"; });
    expect(validateEscala(input).valid).toBe(true);
    expect(refineRoster(input)).toBe(input);
  });
  it("keeps Sundays and their staffing untouched even when a Sunday would offer a larger gain", () => {
    const input = fixture();
    input.assignments.filter(a => a.employeeId === "p1" && a.date === "2026-11-08").forEach(a => { a.locked = false; });
    input.demands.push({ id: "sun", date: "2026-11-08", sector: "Loja", start: 480, end: 1044, minimum: 4, estimated: true });
    const refined = refineRoster(input);
    expect(refined.assignments.filter(a => a.date === "2026-11-08")).toEqual(input.assignments.filter(a => a.date === "2026-11-08"));
    expect(validateEscala(refined).valid).toBe(true);
  });
  it("returns unbuilt, invalid and already unhelpful rosters unchanged", () => {
    const empty = fixture(); empty.assignments = [];
    expect(refineRoster(empty)).toBe(empty);
    const invalid = fixture(); invalid.employees[0].weeklyHours = 40;
    expect(validateEscala(invalid).valid).toBe(false); expect(refineRoster(invalid)).toBe(invalid);
    const noDemand = fixture(); noDemand.demands = [];
    expect(refineRoster(noDemand)).toBe(noDemand);
  });
});
