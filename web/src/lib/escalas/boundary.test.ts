import { describe, expect, it } from "vitest";
import { fixedBoundaryReservations } from "./boundary";
import { addDays, dateRange, dayOfWeek } from "./dates";
import type { EscalaAssignment, EscalaInput } from "./types";
import { validateEscala } from "./validation";

function sundayMondayFixture(): EscalaInput {
  const startDate = "2026-10-26";
  const endDate = "2026-11-01";
  const assignment = (day: string): EscalaAssignment => {
    const off = [0, 6].includes(dayOfWeek(day));
    return { employeeId: "person-1", date: day, kind: off ? "OFF" : "WORK", ...(off ? {} : { shiftId: "day" }) };
  };
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial 02", startDate, endDate,
    defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: {
      source: "Norma confirmada do cenário de teste", validFrom: "2026-01-01", validUntil: "2027-12-31",
      reviewed: true, reviewedBy: "Responsável de teste", weeklyLimit: 44, dailyLimitMinutes: 600,
      compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false,
    },
    employees: [{
      id: "person-1", registration: "0001", name: "Ana Silva", sector: "Reposição", role: "Repositor",
      weeklyHours: 40, shiftIds: ["day"], activeFrom: "1995-05-01", offMode: "FIXED", fixedOffDays: [0, 6],
      offPattern: "CONSECUTIVE", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: true,
      history: dateRange(addDays(startDate, -21), addDays(startDate, -1)).map(assignment),
    }],
    shifts: [{ id: "day", name: "Diurno", segments: [
      { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" },
    ] }],
    demands: dateRange(startDate, endDate).map((day) => ({ id: `d-${day}`, date: day, sector: "Reposição", start: 480, end: 720, minimum: [0, 6].includes(dayOfWeek(day)) ? 0 : 1 })),
    assignments: dateRange(startDate, endDate).map(assignment),
  };
}

describe("explicit fixed off-day boundary reservations", () => {
  it("publishes a stable Sunday/Monday fixed pattern with actual history and a reserved next Monday", () => {
    const input = sundayMondayFixture();
    const originalAssignments = structuredClone(input.assignments);
    const result = validateEscala(input);
    expect(result.issues).toEqual([]);
    expect(result.readyToPublish).toBe(true);
    expect(result.boundaryReservations).toEqual([{ employeeId: "person-1", date: "2026-11-02", kind: "OFF", locked: true }]);
    expect(result.summaries[0]).toEqual(expect.objectContaining({ workDays: 5, offDays: 2, workedMinutes: 2400 }));
    expect(input.assignments).toEqual(originalAssignments);
    expect(input.employees[0].history).toHaveLength(21);
  });

  it("accepts mixed days only when Monday itself is the approved fixed day", () => {
    const input = sundayMondayFixture();
    input.employees[0].offMode = "MIXED";
    input.employees[0].fixedOffDays = [0];
    expect(validateEscala(input).readyToPublish).toBe(true);
    expect(fixedBoundaryReservations(input)).toHaveLength(1);
    input.employees[0].fixedOffDays = [6];
    expect(fixedBoundaryReservations(input)).toEqual([]);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_PENDING", date: input.endDate }));
  });

  it("does not infer a variable Monday off", () => {
    const input = sundayMondayFixture();
    input.employees[0].offMode = "VARIABLE";
    input.employees[0].fixedOffDays = [];
    expect(fixedBoundaryReservations(input)).toEqual([]);
    expect(validateEscala(input).readyToPublish).toBe(false);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_PENDING", date: input.endDate }));
  });

  it("does not reserve a day after employment has ended", () => {
    const input = sundayMondayFixture();
    input.employees[0].activeUntil = input.endDate;
    expect(fixedBoundaryReservations(input)).toEqual([]);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_PENDING", date: input.endDate }));
  });

  it("does not reserve a holiday where rest is prohibited; a closed store does not prohibit rest", () => {
    const input = sundayMondayFixture();
    input.policy.holidayDates = ["2026-11-02"];
    expect(fixedBoundaryReservations(input)).toEqual([]);
    expect(validateEscala(input).readyToPublish).toBe(false);
    input.policy.holidayRestAllowed = true;
    expect(fixedBoundaryReservations(input)).toHaveLength(1);
    input.policy.closedDates = ["2026-11-02"];
    expect(fixedBoundaryReservations(input)).toHaveLength(1);
    expect(validateEscala(input).readyToPublish).toBe(true);
  });

  it("does not create reservations without the terminal off assignment or an obligatory consecutive pattern", () => {
    const input = sundayMondayFixture();
    input.assignments.pop();
    expect(fixedBoundaryReservations(input)).toEqual([]);
    input.assignments.push({ employeeId: "person-1", date: input.endDate, kind: "OFF" });
    input.employees[0].offPattern = "PREFER_CONSECUTIVE";
    expect(fixedBoundaryReservations(input)).toEqual([]);
  });

  it("warns about missing real history and does not invent the previous Sunday for a required pair", () => {
    const input = sundayMondayFixture();
    input.employees[0].history.pop();
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "HISTORY_UNVERIFIED", severity: "WARNING" }));
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_PENDING", date: input.startDate }));
    expect(validateEscala(input).readyToPublish).toBe(false);
  });
});
