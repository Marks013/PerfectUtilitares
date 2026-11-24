import { newEmployee } from "@/components/escalas/workspace-model";
import { describe, expect, it } from "vitest";
import { dayOfWeek, visibleDates } from "./dates";
import { newLegacyInput } from "./legacy-calendar-test-fixture";
import { inheritMonthlyPattern } from "./monthly-pattern";
import type { EscalaAssignment, EscalaInput, EscalaShift } from "./types";

const clock: EscalaShift = { id: "previous-clock", name: "Anterior", segments: [
  { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 810, kind: "BREAK" },
  { start: 810, end: 1050, kind: "WORK" },
] };

function setup(rest: (date: string, offset: number) => boolean = date => [4, 6].includes(dayOfWeek(date))) {
  const source = newLegacyInput("07", "Loja", "2026-11", 40);
  const target = newLegacyInput("07", "Loja", "2026-12", 40);
  source.policy = { ...source.policy, holidayDates: [], closedDates: [], authorizedHolidayDates: [], paidHolidayDates: [] };
  target.policy = { ...target.policy, holidayDates: [], closedDates: [], authorizedHolidayDates: [], paidHolidayDates: [] };
  source.shifts = [clock];
  target.shifts = [{ ...clock, id: "approved-clock", name: "Atual" }];
  source.employees = [{ ...newEmployee(40, clock.id), id: "previous", registration: "0007", sector: "Caixa" }];
  target.employees = [{ ...newEmployee(40, "approved-clock"), id: "current", registration: "0007", sector: "Caixa" }];
  source.assignments = visibleDates(source).map((date, offset) => rest(date, offset)
    ? { employeeId: "previous", date, kind: "OFF", locked: true }
    : { employeeId: "previous", date, kind: "WORK", shiftId: clock.id, locked: true });
  target.assignments = [];
  return { source, target };
}

function on(input: EscalaInput, date: string) {
  return input.assignments.find(item => item.date === date);
}

describe("monthly operational pattern", () => {
  it("projects only visible blank days by unique registration and reuses exact approved geometry", () => {
    const { source, target } = setup();
    target.generationMode = "REST_ONLY";
    const existing: EscalaAssignment = { employeeId: "current", date: "2026-12-04", kind: "ABSENCE", absenceSource: "MANUAL", locked: true };
    target.assignments = [existing];
    const next = inheritMonthlyPattern(target, source);
    expect(next.assignments).toHaveLength(31);
    expect(on(next, "2026-12-01")).toEqual({ employeeId: "current", date: "2026-12-01", kind: "WORK", shiftId: "approved-clock", locked: false, monthlyCarry: true });
    expect(on(next, "2026-12-06")).toEqual({ employeeId: "current", date: "2026-12-06", kind: "OFF", locked: false, monthlyCarry: true });
    expect(on(next, existing.date)).toBe(existing);
    expect(next.assignments.every(day => day.date.startsWith("2026-12"))).toBe(true);
    expect(next.shifts).toBe(target.shifts);
    expect(next.employees).toBe(target.employees);
    expect(target.assignments).toEqual([existing]);
  });

  it("continues the 14-day phase and refuses inconsistent or under-observed alternation", () => {
    const { source, target } = setup((date, offset) => dayOfWeek(date) === 4 || offset % 14 === 0);
    const next = inheritMonthlyPattern(target, source);
    expect(on(next, "2026-12-06")?.kind).toBe("WORK");
    expect(on(next, "2026-12-13")?.kind).toBe("OFF");
    const underObserved = { ...source, assignments: source.assignments.filter(day => day.date !== "2026-11-08") };
    expect(inheritMonthlyPattern(target, underObserved)).toBe(target);
    const conflicting = { ...source, assignments: source.assignments.map(day => day.date === "2026-11-22" ? { ...day, kind: "OFF" as const, shiftId: undefined } : day) };
    expect(inheritMonthlyPattern(target, conflicting)).toBe(target);
  });

  it("records coinciding holiday and rest only where lawful and protects existing rows", () => {
    const { source, target } = setup();
    target.policy.holidayDates = ["2026-12-04", "2026-12-18", "2026-12-25"];
    target.policy.closedDates = target.policy.paidHolidayDates = ["2026-12-25"];
    target.policy.holidayRestAllowed = false;
    target.assignments = [{ employeeId: "current", date: "2026-12-25", kind: "HOLIDAY", locked: true }];
    const next = inheritMonthlyPattern(target, source);
    expect(on(next, "2026-12-04")).toBeUndefined();
    expect(on(next, "2026-12-25")).toEqual({ ...target.assignments[0], monthlyCarry: true, carriedHolidayRest: true });
    expect(target.assignments[0]).not.toHaveProperty("carriedHolidayRest");
    const allowsRest = inheritMonthlyPattern({ ...target, policy: { ...target.policy, holidayRestAllowed: true } }, source);
    expect(on(allowsRest, "2026-12-18")).toMatchObject({ kind: "OFF", monthlyCarry: true, carriedHolidayRest: true });
  });

  it("keeps changed breaks, current fixed days, closures and the employment interval protected", () => {
    const { source, target } = setup();
    target.employees[0] = { ...target.employees[0], activeFrom: "2026-12-09", activeUntil: "2026-12-22", offMode: "FIXED", fixedOffDays: [0, 1] };
    target.policy.closedDates = ["2026-12-10"];
    const next = inheritMonthlyPattern(target, source);
    expect(on(next, "2026-12-09")?.kind).toBe("WORK");
    for (const date of ["2026-12-03", "2026-12-10", "2026-12-14", "2026-12-23"]) expect(on(next, date)).toBeUndefined();
    target.shifts[0] = { ...target.shifts[0], segments: [clock.segments[0], { ...clock.segments[1], end: 800 }, { ...clock.segments[2], start: 800 }] };
    expect(inheritMonthlyPattern(target, source).assignments.every(day => day.kind !== "WORK")).toBe(true);
  });

  it("ignores another branch, another month, duplicate registrations and hours-only generation", () => {
    const { source, target } = setup();
    const wrongBranch = { ...source, branchCode: "08" };
    const skippedMonth = newLegacyInput("07", "Loja", "2026-10", 40);
    const ambiguous = { ...source, employees: [...source.employees, { ...source.employees[0], id: "duplicate" }] };
    for (const unsuitable of [wrongBranch, skippedMonth, ambiguous]) expect(inheritMonthlyPattern(target, unsuitable)).toBe(target);
    const hoursOnly: EscalaInput = { ...target, generationMode: "HOURS_ONLY" };
    expect(inheritMonthlyPattern(hoursOnly, source)).toBe(hoursOnly);
  });
});
