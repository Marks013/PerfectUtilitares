import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { dateRange } from "./dates";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { planningMonthPeriod, planningWeekEnd, planningWeeks, planningWeekStart } from "./planning-calendar";
import { escalaInputSchema } from "./schema";
import type { EscalaInput, EscalaWorkspace } from "./types";
import { findGenerationConflicts } from "./generation-conflicts";
import { weeklySectorCapacity } from "./weekly-capacity";
import { mixedWeeklyApplication } from "./mixed-week-report";
import { validateEscala } from "./validation";

const period = { startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY" } as const;
const id = "cutover-person";

function fixture(): EscalaInput {
  const offs = new Set([1, 3, 6, 9, 13, 16, 20, 23, 27, 30]);
  return {
    ...period, visibleMonth: "2026-12", schemaVersion: 1, branchCode: "02", branchName: "Filial 02", timeZone: "America/Sao_Paulo", defaultWeeklyHours: 42,
    policy: {
      source: "Regra sintética", validFrom: period.startDate, validUntil: period.endDate, reviewed: true, reviewedBy: "Teste",
      weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
      minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [],
      holidayRestAllowed: true, nightWorkReviewed: false,
    },
    employees: [{ id, registration: "0001", name: "Pessoa de teste", sector: "Reposição", role: "Repositor",
      weeklyHours: 42, shiftIds: ["day"], activeFrom: period.startDate, offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: false, history: [],
    }],
    shifts: [{ id: "day", name: "Diurno", segments: [
      { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" },
    ] }],
    demands: [],
    assignments: dateRange(period.startDate, period.endDate).map(date =>
      offs.has(Number(date.slice(-2))) ? { employeeId: id, date, kind: "OFF" } : { employeeId: id, date, kind: "WORK", shiftId: "day" }),
  };
}

describe("December 2026 planning transition", () => {
  it("keeps both civil boundaries in December and begins the next week on Sunday the sixth", () => {
    expect(planningMonthPeriod("2026-12", period)).toEqual({ startDate: period.startDate, endDate: period.endDate });
    expect(planningWeeks(period).map(week => [week.startDate, week.endDate, week.dates.length])).toEqual([
      ["2026-12-01", "2026-12-05", 5], ["2026-12-06", "2026-12-12", 7], ["2026-12-13", "2026-12-19", 7],
      ["2026-12-20", "2026-12-26", 7], ["2026-12-27", "2026-12-31", 5],
    ]);
    expect(planningWeekStart("2026-12-04", period)).toBe("2026-12-01");
    expect(planningWeekStart("2026-12-06", period)).toBe("2026-12-06");
    expect(planningWeekEnd("2026-12-30", period)).toBe("2026-12-31");
    expect(escalaInputSchema.safeParse(fixture()).success).toBe(true);
  });

  it("accepts two first-week rests without exact full weekly hours and preserves requirements in complete weeks", () => {
    const input = fixture();
    const current = validateEscala(input);
    expect(current.issues.filter(issue => issue.code === "WEEKLY_MINUTES")).toEqual([]);
    expect(current.issues.filter(issue => issue.code === "FIVE_BY_TWO")).toEqual([]);
    input.assignments = input.assignments.map(day => day.date === "2026-12-09" ? { ...day, kind: "WORK", shiftId: "day" } : day);
    expect(validateEscala(input).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FIVE_BY_TWO", date: "2026-12-06" }),
      expect.objectContaining({ code: "WEEKLY_LIMIT", date: "2026-12-06" }),
    ]));
  });

  it("separates nominal capacity from the clipped opening and counts the monthly roster once", () => {
    const input = fixture();
    expect(weeklySectorCapacity(input)).toEqual([expect.objectContaining({
      people: 1, currentHours: 42, currentHoursMax: 42, availableHoursMin: 25.2,
      availableHoursMax: 42, timedPeopleDays: 21, scheduledHours: expect.closeTo(176.4),
    })]);
  });

  it("reports the opening minimum against three workdays and ends the week on the fifth", () => {
    const input = fixture();
    input.demands = dateRange("2026-12-01", "2026-12-05").map(date => ({
      id: date, date, sector: "Reposição", start: 480, end: 960, minimum: 1,
    }));
    expect(findGenerationConflicts(input)).toEqual([expect.objectContaining({
      code: "COVERAGE_WEEKLY_CAPACITY", date: "2026-12-01",
      message: expect.stringContaining("01/12/2026 a 05/12/2026, mas a equipe com horário tem capacidade de, no máximo, 25h12"),
    })]);
  });

  it("prints the actual clipped week boundaries for mixed-hours references", () => {
    const input = fixture();
    input.mixed42Sectors = ["Reposição"];
    expect(mixedWeeklyApplication(input, input.employees[0], ["2026-12-01", "2026-12-06", "2026-12-31"]))
      .toBe("01/12–05/12: 1 dia · Ter 01\n06/12–12/12: 1 dia · Dom 06\n27/12–31/12: 1 dia · Qui 31");
  });

  it("exports December's 31 civil days and both partial week labels as XLSX and PDF", async () => {
    const input = fixture();
    const workspace: EscalaWorkspace = {
      id: "december", revision: 1, status: "DRAFT", canEdit: true, canPublish: false,
      updatedAt: "2026-12-01T12:00:00Z", input, validation: validateEscala(input),
    };
    const calendarLabel = "domingo a sábado (01–05/12 e 27–31/12 parciais)";
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace, "rest")), "Escala");
    expect(rows[2][0]).toContain(calendarLabel);
    const dayHeaders = rows[3].slice(5);
    const dates = dateRange(input.startDate, input.endDate).map(date => date.slice(8));
    expect(dayHeaders.map(header => String(header).split("\n")[0])).toEqual(dates);

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = await exportEscalaPdf(workspace, "rest", { projection: "BASIC_SCHEDULE" });
    const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    try {
      const document = await loading.promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      const words = content.items.flatMap(item => "str" in item ? [item.str] : []);
      expect(words.join(" ").replace(/\s+/g, " ")).toContain(calendarLabel);
      expect(words).toEqual(expect.arrayContaining(dates));
    } finally {
      await loading.destroy();
    }
  });

  it("does not let Sunday the sixth count as the second rest of the cutover week", () => {
    const input = fixture();
    input.assignments[2] = { employeeId: id, date: "2026-12-03", kind: "WORK", shiftId: "day" };
    const issues = validateEscala(input).issues.filter(issue => issue.code === "FIVE_BY_TWO");
    expect(issues).toEqual([expect.objectContaining({
      date: "2026-12-01", message: expect.stringContaining("de 01/12/2026 a 05/12/2026"),
    })]);
  });

  it("does not turn a locked absence in the first block into regular rest", () => {
    const input = fixture();
    input.assignments[2] = { employeeId: id, date: "2026-12-03", kind: "ABSENCE", locked: true };
    const issues = validateEscala(input).issues;
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ABSENCE_AVAILABILITY", date: "2026-12-03" })]));
    expect(issues.some(issue => issue.code === "FIVE_BY_TWO" && issue.date === period.startDate)).toBe(false);
  });
});
