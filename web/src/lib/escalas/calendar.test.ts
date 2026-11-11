import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { applyLocalHolidayCalendar, assertHolidayLocks, holidayCalendarFor, holidayLabel } from "./calendar";
import { prepareGeneration } from "./generation";
import { validateEscala } from "./validation";
import { interveningOffs, workJourney } from "./validation-time";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

function week(start = "2026-12-21", end = "2026-12-27"): EscalaInput {
  const input = newInput("08", "Loja", "2026-12", 42);
  input.startDate = start; input.endDate = end; delete input.visibleMonth;
  input.simulation = true; input.shifts = [{ id: "day", name: "Importado", segments: [
    { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" },
  ] }];
  input.employees = [{ ...newEmployee(42, "day"), id: "p", registration: "1", name: "Pessoa", sector: "Caixa", role: "Operador", scheduleMode: "TIMED" }];
  input.demands = []; input.assignments = [];
  return applyLocalHolidayCalendar(input);
}

describe("local holiday calendar", () => {
  it("uses Icaraíma only for branch 02 and Umuarama for the other branches", () => {
    const icaraima = holidayCalendarFor({ branchCode: "2", startDate: "2026-01-01", endDate: "2026-12-31" });
    const umuarama = holidayCalendarFor({ branchCode: "08", startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(icaraima.label).toBe("Icaraíma-PR"); expect(umuarama.label).toBe("Umuarama-PR");
    expect(icaraima.holidays.map(day => day.date)).toContain("2026-07-25");
    expect(icaraima.holidays.map(day => day.date)).not.toContain("2026-06-26");
    expect(icaraima.holidays.map(day => day.date)).not.toContain("2026-10-04");
    expect(umuarama.holidays.map(day => day.date)).toEqual(expect.arrayContaining(["2026-06-26", "2026-10-04"]));
  });
  it.each([[2026, "04-03", "06-04"], [2027, "03-26", "05-27"]])("computes movable holidays for %i without discretionary public-service dates", (year, passion, corpus) => {
    const rows = holidayCalendarFor({ branchCode: "02", startDate: `${year}-01-01`, endDate: `${year}-12-31` }).holidays;
    expect(rows.map(day => day.date)).toEqual(expect.arrayContaining([`${year}-${passion}`, `${year}-${corpus}`]));
    expect(rows.some(day => /Carnaval|facultativo/.test(day.name))).toBe(false);
    expect(rows.map(day => day.date)).not.toContain(`${year}-12-19`);
    expect(rows.filter(day => day.closed).map(day => day.date)).toEqual([`${year}-01-01`, `${year}-05-01`, `${year}-12-25`]);
  });
  it("retains manual dates, deduplicates, updates provenance after branch changes and never creates an opening authorization", () => {
    const raw = newInput("08", "Loja", "2026-06", 42); raw.policy.holidayDates = ["2026-06-17"]; raw.policy.closedDates = ["2026-06-18"];
    const before = structuredClone(raw), first = applyLocalHolidayCalendar(raw);
    expect(first.policy.holidayDates).toEqual(expect.arrayContaining(["2026-06-17", "2026-06-26"]));
    expect(first.policy.closedDates).toContain("2026-06-18");
    expect(first.policy.authorizedHolidayDates).toEqual([]);
    expect(applyLocalHolidayCalendar(first)).toBe(first);
    const other = applyLocalHolidayCalendar({ ...first, branchCode: "02" });
    expect(other.policy.holidayDates).not.toContain("2026-06-26");
    expect(other.policy.holidayDates).toContain("2026-06-17");
    expect(raw).toEqual(before);
    const manual = { ...first, policy: { ...first.policy, calendarMode: "MANUAL" as const } };
    expect(applyLocalHolidayCalendar(manual)).toBe(manual);
  });
  it("removes only automatic coverage on closures, preserving positive operational demand as a conflict", () => {
    const raw = newInput("08", "Loja", "2026-12", 42);
    raw.demands = [true, false].map((estimated, index) => ({ id: String(index), date: "2026-12-25", sector: "Caixa", start: 480, end: 600, minimum: 1, estimated }));
    const next = applyLocalHolidayCalendar(raw);
    expect(next.demands).toEqual([raw.demands[1]]);
    expect(holidayLabel(next, "2026-12-25")).toBe("Natal");
    expect(holidayLabel(next, "2026-12-24")).toBeUndefined();
  });
  it("refuses to rewrite a locked assignment on a closed holiday", () => {
    const input = week(); input.assignments = [{ employeeId: "p", date: "2026-12-25", kind: "WORK", shiftId: "day", locked: true }];
    expect(assertHolidayLocks(input)).toBe("2026-12-25");
    expect(() => prepareGeneration(input)).toThrow(/bloqueado/);
    input.assignments[0] = { employeeId: "p", date: "2026-12-25", kind: "ABSENCE", locked: true };
    expect(assertHolidayLocks(input)).toBeUndefined();
  });
  it("validates Christmas as four workdays, two regular rests and a distinct closure without fake work minutes", () => {
    const input = week();
    input.assignments = ["21", "22", "23", "24"].map(day => ({ employeeId: "p", date: `2026-12-${day}`, kind: "WORK" as const, shiftId: "day" }));
    input.assignments.push({ employeeId: "p", date: "2026-12-25", kind: "HOLIDAY" }, { employeeId: "p", date: "2026-12-26", kind: "OFF" }, { employeeId: "p", date: "2026-12-27", kind: "OFF" });
    const result = validateEscala(input);
    expect(result.issues.filter(issue => issue.severity === "ERROR")).toEqual([]);
    expect(result.summaries[0]).toMatchObject({ workedMinutes: 2016, workDays: 4, offDays: 2 });
    expect(result.issues.some(issue => issue.code === "HOLIDAY_WEEK")).toBe(true);
    expect(input.assignments.some(day => day.kind === "ABSENCE")).toBe(false);
  });
  it("keeps a closed Sunday as regular rest for consecutive days without inventing an extra weekday off", () => {
    const input = week("2022-12-19", "2022-12-25");
    input.employees[0].offPattern = "CONSECUTIVE";
    input.assignments = ["19", "20", "21", "22", "23"].map(day => ({ employeeId: "p", date: `2022-12-${day}`, kind: "WORK" as const, shiftId: "day" }));
    input.assignments.push({ employeeId: "p", date: "2022-12-24", kind: "OFF" }, { employeeId: "p", date: "2022-12-25", kind: "HOLIDAY" });
    expect(validateEscala(input).issues.some(issue => ["CONSECUTIVE_OFF", "FIVE_BY_TWO", "WEEKLY_MINUTES"].includes(issue.code))).toBe(false);
    input.assignments = input.assignments.map(day => day.date === "2022-12-24"
      ? { ...day, kind: "WORK", shiftId: "day" } : day.date === "2022-12-21"
        ? { employeeId: day.employeeId, date: day.date, kind: "OFF" } : day);
    expect(validateEscala(input).issues.some(issue => issue.code === "CONSECUTIVE_OFF")).toBe(true);
  });
  it("rejects a client-supplied extra paid closure and derives automatic closures from the calendar", () => {
    const input = week();
    input.policy.holidayDates.push("2026-12-23"); input.policy.closedDates.push("2026-12-23");
    input.policy.paidHolidayDates = [...(input.policy.paidHolidayDates ?? []), "2026-12-23"];
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    const normalized = applyLocalHolidayCalendar(input);
    expect(normalized.policy.paidHolidayDates).toEqual(["2026-12-25"]);
    expect(normalized.policy.closedDates).toContain("2026-12-23");
  });
  it("recognizes a closed Saturday in the same civil-rest check as the solver, without counting it as regular OFF", () => {
    const previous = workJourney({ employeeId: "p", date: "2027-04-30", kind: "WORK", shiftId: "late" },
      { id: "late", name: "Sexta", segments: [{ start: 840, end: 1200, kind: "WORK" }] });
    const next = workJourney({ employeeId: "p", date: "2027-05-02", kind: "WORK", shiftId: "early" },
      { id: "early", name: "Domingo", segments: [{ start: 360, end: 720, kind: "WORK" }] });
    expect(next.start - previous.end).toBe(34 * 60);
    expect(interveningOffs(previous, next, new Map([["2027-05-01", { employeeId: "p", date: "2027-05-01", kind: "HOLIDAY" }]]))).toBe(true);
  });
  it("keeps Sunday rest on an open holiday but rejects weekday holiday rest and a false closed-holiday marker", () => {
    const input = week("2026-11-09", "2026-11-15");
    input.assignments = ["09", "10", "11", "12", "13"].map(day => ({ employeeId: "p", date: `2026-11-${day}`, kind: "WORK" as const, shiftId: "day" }));
    input.assignments.push({ employeeId: "p", date: "2026-11-14", kind: "OFF" }, { employeeId: "p", date: "2026-11-15", kind: "OFF" });
    expect(validateEscala(input).issues.some(issue => issue.code === "HOLIDAY_REST")).toBe(false);
    input.policy.holidayDates.push("2026-11-14");
    expect(validateEscala(input).issues.some(issue => issue.code === "HOLIDAY_REST")).toBe(true);
    input.assignments[0] = { employeeId: "p", date: "2026-11-09", kind: "HOLIDAY" };
    expect(validateEscala(input).issues.some(issue => issue.code === "HOLIDAY_INVALID")).toBe(true);
  });
});
