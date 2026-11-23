import { describe, expect, it } from "vitest";
import { planningMonthPeriod, planningWeekEnd, planningWeeks, planningWeekStart, planningWeekStartsOn,
  type PlanningCalendar, type PlanningPeriod, type PlanningWeek, type PlanningWeekStartsOn } from "./planning-calendar";

const sunday: PlanningCalendar = { planningWeekStartsOn: "SUNDAY" };

describe("planning calendar in the standard quality gate", () => {
  it("preserves absent metadata and gives Sunday to its own week only when selected", () => {
    expect(planningWeekStartsOn()).toBe("MONDAY");
    expect(planningWeekStart("2026-12-13")).toBe("2026-12-07");
    expect(planningWeekEnd("2026-12-13")).toBe("2026-12-13");
    expect(planningWeekStart("2026-12-13", sunday)).toBe("2026-12-13");
    expect(planningWeekEnd("2026-12-13", sunday)).toBe("2026-12-19");
    expect(planningWeeks({ startDate: "2026-12-07", endDate: "2026-12-13" })).toHaveLength(1);
    expect(planningMonthPeriod("2026-12")).toEqual({ startDate: "2026-11-30", endDate: "2027-01-03" });
    expect(planningWeeks({ startDate: "2026-11-29", endDate: "2027-01-02", ...sunday }).map(week => week.dates.length)).toEqual([7, 7, 7, 7, 7]);
    expect(planningWeekStartsOn(Object.create(null))).toBe("MONDAY");
  });

  it("rejects malformed metadata instead of selecting a different convention", () => {
    for (const value of [null, false, 0, "", "SUNDAY", [], new Date(), new Map(),
      Object.create({ planningWeekStartsOn: "SUNDAY" }), { planningWeekStartsOn: "SATURDAY" }]) {
      const invalid = value as unknown as PlanningCalendar;
      expect(() => planningWeekStartsOn(invalid)).toThrow();
      expect(() => planningMonthPeriod("2026-12", invalid)).toThrow();
    }
  });

  it.each([
    ["2027-01", "2026-12-27", "2027-02-06", 6],
    ["2026-02", "2026-02-01", "2026-02-28", 4],
  ] as const)("expands %s without shifting employee dates", (month, startDate, endDate, count) => {
    const period: PlanningPeriod = planningMonthPeriod(month, sunday);
    expect(period).toEqual({ startDate, endDate });
    const input = Object.freeze({ ...period, ...sunday });
    const weeks: PlanningWeek[] = planningWeeks(input);
    expect(weeks).toHaveLength(count);
    const days = weeks.flatMap(week => week.dates);
    expect(new Set(days).size).toBe(7 * count);
    expect(days[0]).toBe(startDate);
    expect(days.at(-1)).toBe(endDate);
  });

  it("keeps civil arithmetic valid at its boundaries without widening planning horizons", () => {
    expect(planningWeekStart("1900-01-01", sunday)).toBe("1899-12-31");
    expect(planningWeekEnd("1900-01-01", sunday)).toBe("1900-01-06");
    expect(planningWeekEnd("2099-12-31", sunday)).toBe("2100-01-02");
    for (const [startDate, endDate] of [["1999-12-26", "2000-01-01"], ["2026-12-07", "2026-12-13"],
      ["2026-12-06", "2026-12-11"], ["2026-12-06", "2027-01-23"], ["2026-12-13", "2026-12-06"]]) {
      expect(() => planningWeeks({ startDate, endDate, ...sunday })).toThrow();
    }
    const conventions: PlanningWeekStartsOn[] = ["MONDAY", "SUNDAY"];
    for (const planningWeekStartsOn of conventions) for (const month of ["2000-01", "2099-12"]) {
      expect(() => planningMonthPeriod(month, { planningWeekStartsOn })).toThrow();
    }
  });

  it("rejects impossible dates and noncanonical input strings", () => {
    for (const value of [null, 20261201, "2026-02-29", "2026-13-01", "2026-12-01\n", "2026-1-01"]) {
      expect(() => planningWeekStart(value as string, sunday)).toThrow();
    }
    for (const value of [null, 202612, "2026-2", "2026-13", "2026-12\n", "2100-01"]) {
      expect(() => planningMonthPeriod(value as string, sunday)).toThrow();
    }
  });
});
