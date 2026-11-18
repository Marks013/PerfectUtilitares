import { describe, expect, it } from "vitest";
import { coverageBasis, proposeAutomaticCoverage } from "./automatic-coverage";
import { fixedBoundaryReservations } from "./boundary";
import { addDays, dateRange } from "./dates";
import { findGenerationConflicts } from "./generation-conflicts";
import { effectiveWeeklyHours, effectiveWeeklyMinutes, transitionWeeks, usesMixed42Week } from "./labor-rules";
import type { EscalaAssignment, EscalaInput, WeeklyHours } from "./types";
import { validateEscala } from "./validation";
import { weeklySectorCapacity } from "./weekly-capacity";

function fixture(hours: WeeklyHours = 42): EscalaInput {
  const startDate = "2026-12-06", endDate = "2026-12-19";
  const offDates = new Set(["2026-12-08", "2026-12-11", "2026-12-13", "2026-12-16"]);
  return {
    schemaVersion: 1, branchCode: "06", branchName: "Teste de calendário", startDate, endDate,
    planningWeekStartsOn: "SUNDAY", defaultWeeklyHours: hours, timeZone: "America/Sao_Paulo", simulation: true,
    policy: {
      source: "", validFrom: "2026-01-01", validUntil: "2028-12-31", reviewed: false, reviewedBy: "",
      weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: false, closedDates: [], holidayDates: [],
      authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false,
    },
    employees: [{
      id: "person", registration: "SYNTHETIC", name: "Pessoa sintética", sector: "Caixa", role: "Operador",
      weeklyHours: hours, weeklyHoursMode: "INDIVIDUAL", shiftIds: ["day"], scheduleMode: "TIMED",
      activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY",
      maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: false, history: [],
    }],
    shifts: [{ id: "day", name: "Referência", segments: [
      { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
      { start: 780, end: 780 + hours * 12 - 240, kind: "WORK" },
    ] }],
    demands: [],
    assignments: dateRange(startDate, endDate).map(date => ({
      employeeId: "person", date, kind: offDates.has(date) ? "OFF" : "WORK",
      ...(!offDates.has(date) ? { shiftId: "day" } : {}),
    })),
  };
}

const weekCodes = (input: EscalaInput) => validateEscala(input).issues
  .filter(issue => ["FIVE_BY_TWO", "WEEKLY_MINUTES", "WEEKLY_LIMIT", "MIXED_42_WEEK"].includes(issue.code));

describe("versioned Sunday weeks in production TypeScript consumers", () => {
  it("validates two actual Sunday–Saturday weeks without borrowing the following Sunday", () => {
    const input = fixture(), original = structuredClone(input);
    expect(input.assignments.find(day => day.date === "2026-12-06")?.kind).toBe("WORK");
    expect(input.assignments.find(day => day.date === "2026-12-13")?.kind).toBe("OFF");
    for (const start of ["2026-12-06", "2026-12-13"]) {
      const records = input.assignments.filter(day => day.date >= start && day.date <= addDays(start, 6));
      expect(records.filter(day => day.kind === "WORK")).toHaveLength(5);
      expect(records.filter(day => day.kind === "OFF")).toHaveLength(2);
    }
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(weekCodes(input)).toEqual([]);
    expect(result.summaries[0]).toMatchObject({ workedMinutes: 5040, workDays: 10, offDays: 4 });
    expect(input).toEqual(original);
  });

  it("rejects using 13 December as the second rest of the preceding week", () => {
    const input = fixture();
    input.assignments = input.assignments.map(day => day.date === "2026-12-11"
      ? { ...day, kind: "WORK", shiftId: "day" } : day);
    const result = validateEscala(input);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FIVE_BY_TWO", date: "2026-12-06" }),
      expect.objectContaining({ code: "WEEKLY_LIMIT", date: "2026-12-06" }),
    ]));
    expect(result.issues.some(issue => issue.code === "FIVE_BY_TWO" && issue.date === "2026-12-13")).toBe(false);
  });

  it("applies the same weekly day counts to ENC without inventing hourly coverage", () => {
    const input = fixture();
    input.employees[0].scheduleMode = "UNTIMED"; input.employees[0].shiftIds = [];
    input.assignments = input.assignments.map(day => day.kind === "WORK"
      ? { employeeId: day.employeeId, date: day.date, kind: "DUTY" } : day);
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(weekCodes(input)).toEqual([]);
    expect(result.summaries[0]).toMatchObject({ workedMinutes: 0, workDays: 10, offDays: 4 });
    input.assignments = input.assignments.map(day => day.date === "2026-12-11"
      ? { ...day, kind: "DUTY" } : day);
    expect(weekCodes(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FIVE_BY_TWO", date: "2026-12-06" }),
    ]));
    expect(proposeAutomaticCoverage(input).demands).toEqual([]);
  });

  it("uses the selected week end at the December transition, retaining legacy Monday behavior", () => {
    const person = { weeklyHours: 44 as const };
    expect(effectiveWeeklyHours(person, "2026-12-13", { planningWeekStartsOn: "SUNDAY" })).toBe(42);
    expect(effectiveWeeklyMinutes(person, "2026-12-13", { planningWeekStartsOn: "SUNDAY" })).toBe(2520);
    expect(effectiveWeeklyHours(person, "2026-12-13")).toBe(44);
    expect(effectiveWeeklyHours(person, "2026-12-13", { planningWeekStartsOn: "MONDAY" })).toBe(44);
    expect(transitionWeeks({ startDate: "2026-12-06", endDate: "2026-12-19", planningWeekStartsOn: "SUNDAY" })).toEqual(["2026-12-13"]);
    expect(transitionWeeks({ startDate: "2026-12-07", endDate: "2026-12-20" })).toEqual(["2026-12-14"]);
  });

  it("changes nominal capacity in the correct Sunday transition week", () => {
    const input = fixture(44);
    input.startDate = "2026-12-13"; input.endDate = "2026-12-19"; input.assignments = [];
    expect(weeklySectorCapacity(input)[0]).toMatchObject({ currentHours: 42, currentHoursMax: 42, scenarioWeeklyHours: 42 });
    input.startDate = "2026-12-07"; input.endDate = "2026-12-13"; delete input.planningWeekStartsOn;
    expect(weeklySectorCapacity(input)[0]).toMatchObject({ currentHours: 44, currentHoursMax: 44, scenarioWeeklyHours: 44 });
  });

  it("keeps the optional three 8h and two 9h days inside one selected week", () => {
    const input = fixture();
    input.endDate = "2026-12-12"; input.mixed42Sectors = ["Caixa"];
    input.policy.mealIntervalAgreement = { source: "Referência sintética", validFrom: "2026-01-01",
      validUntil: "2028-12-31", reviewedBy: "Teste", reviewed: true, maximumMinutes: 180 };
    input.shifts = [
      { id: "short", name: "8h", segments: [{ start: 480, end: 720, kind: "WORK" },
        { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] },
      { id: "long", name: "9h", segments: [{ start: 450, end: 720, kind: "WORK" },
        { start: 720, end: 900, kind: "BREAK" }, { start: 900, end: 1170, kind: "WORK" }] },
    ];
    input.employees[0].shiftIds = ["short", "long"];
    const longDays = new Set(["2026-12-06", "2026-12-09"]), offDays = new Set(["2026-12-08", "2026-12-11"]);
    input.assignments = dateRange(input.startDate, input.endDate).map(date => ({
      employeeId: "person", date, kind: offDays.has(date) ? "OFF" : "WORK",
      ...(!offDays.has(date) ? { shiftId: longDays.has(date) ? "long" : "short" } : {}),
    }));
    expect(usesMixed42Week(input, input.employees[0], "2026-12-06")).toBe(true);
    expect(validateEscala(input).valid).toBe(true);
    expect(weekCodes(input)).toEqual([]);
    expect(validateEscala(input).summaries[0].workedMinutes).toBe(2520);
  });

  it("keeps a closed weekday holiday separate from the two rests of its Sunday week", () => {
    const input = fixture();
    input.startDate = "2026-12-20"; input.endDate = "2026-12-26";
    input.policy.closedDates = ["2026-12-25"]; input.policy.holidayDates = ["2026-12-25"];
    input.policy.paidHolidayDates = ["2026-12-25"];
    const offs = new Set(["2026-12-20", "2026-12-23"]);
    input.assignments = dateRange(input.startDate, input.endDate).map(date => ({
      employeeId: "person", date,
      kind: date === "2026-12-25" ? "HOLIDAY" : offs.has(date) ? "OFF" : "WORK",
      ...(date !== "2026-12-25" && !offs.has(date) ? { shiftId: "day" } : {}),
    }));
    expect(validateEscala(input).valid).toBe(true);
    expect(weekCodes(input)).toEqual([]);
    expect(validateEscala(input).summaries[0]).toMatchObject({ workedMinutes: 2016, workDays: 4, offDays: 2 });
  });

  it("allocates automatic estimated staffing within each selected seven-day budget", () => {
    const input = fixture(40); input.assignments = [];
    input.employees = Array.from({ length: 14 }, (_, index) => ({
      ...structuredClone(input.employees[0]), id: "person-" + index, registration: "SYNTHETIC-" + index,
    }));
    const original = structuredClone(input), result = proposeAutomaticCoverage(input);
    for (const start of ["2026-12-06", "2026-12-13"]) {
      const minutes = result.demands.filter(demand => demand.estimated && demand.date >= start && demand.date <= addDays(start, 6))
        .reduce((sum, demand) => sum + demand.minimum * (demand.end - demand.start), 0);
      expect(minutes).toBe(14 * 5 * 480);
    }
    expect(result.demands.every(demand => demand.date >= input.startDate && demand.date <= input.endDate)).toBe(true);
    expect(input).toEqual(original);
  });

  it("does not combine a Saturday demand with the following Sunday's weekly budget", () => {
    const input = fixture(40); input.assignments = [];
    input.demands = ["2026-12-12", "2026-12-13"].map((date, index) => ({
      id: "demand-" + index, date, sector: "Caixa", role: "Operador", start: 480, end: 1380, minimum: 2,
    }));
    expect(findGenerationConflicts(input).filter(conflict => conflict.code === "COVERAGE_WEEKLY_CAPACITY")).toEqual([]);
    const legacy = { ...input, planningWeekStartsOn: undefined, startDate: "2026-12-07", endDate: "2026-12-20" };
    expect(findGenerationConflicts(legacy)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COVERAGE_WEEKLY_CAPACITY" }),
    ]));
  });

  it("versions the estimated coverage ruler without changing omitted legacy metadata", () => {
    const input = fixture(40), absent = { ...input, planningWeekStartsOn: undefined };
    const original = structuredClone(absent);
    expect(coverageBasis(input)).not.toBe(coverageBasis(absent));
    expect(coverageBasis(absent)).toBe(coverageBasis(original));
    expect(absent).toEqual(original);
  });

  it("reserves an explicitly fixed following day at either weekly boundary without creating clocks", () => {
    const input = fixture();
    input.endDate = "2026-12-12"; input.employees[0].offMode = "MIXED";
    input.employees[0].offPattern = "CONSECUTIVE"; input.employees[0].fixedOffDays = [6];
    input.assignments = [{ employeeId: "person", date: input.endDate, kind: "OFF" }];
    const expected: EscalaAssignment = { employeeId: "person", date: "2026-12-13", kind: "OFF", locked: true };
    expect(fixedBoundaryReservations(input)).toEqual([expected]);
    input.employees[0].planningFuture = [{ employeeId: "person", date: "2026-12-13", kind: "WORK", shiftId: "day" }];
    expect(fixedBoundaryReservations(input)).toEqual([]);
    input.employees[0].planningFuture = []; input.employees[0].fixedOffDays = [0];
    delete input.planningWeekStartsOn; input.startDate = "2026-12-07"; input.endDate = "2026-12-13";
    input.assignments = [{ employeeId: "person", date: input.endDate, kind: "OFF" }];
    expect(fixedBoundaryReservations(input)).toEqual([{ ...expected, date: "2026-12-14" }]);
  });
});
