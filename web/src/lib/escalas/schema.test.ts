import { describe, expect, it } from "vitest";
import { absoluteMinute, addDays, dateRange, dayOfWeek, isDate, weekStart } from "./dates";
import { compareBranches, sortEmployees } from "./order";
import { escalaInputSchema } from "./schema";

const empty = () => ({
  schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
  policy: { source: "", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
  employees: [], shifts: [], demands: [], assignments: [],
});

describe("Escalas boundary schema", () => {
  it("accepts drafts and rejects unknown keys", () => {
    expect(escalaInputSchema.safeParse(empty()).success).toBe(true);
    expect(escalaInputSchema.safeParse({ ...empty(), tenantId: "other-company" }).success).toBe(false);
  });
  it.each(["2026-02-29", "2026-13-01", "2026-11-31", "26/10/2026"])("rejects impossible date %s", (date) => {
    expect(escalaInputSchema.safeParse({ ...empty(), startDate: date }).success).toBe(false);
  });
  it("requires complete weeks and caps the horizon", () => {
    expect(escalaInputSchema.safeParse({ ...empty(), endDate: "2026-10-31" }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...empty(), endDate: "2026-12-13" }).success).toBe(false);
  });
  it("accepts real admissions before 2000 while retaining the planning-period boundary", () => {
    const input = {
      ...empty(),
      shifts: [{ id: "s", name: "Turno", segments: [{ start: 480, end: 720, kind: "WORK" }] }],
      employees: [{
        id: "person-1", registration: "0001", name: "Ana Silva", sector: "Reposição", role: "Repositor",
        weeklyHours: 42, shiftIds: ["s"], activeFrom: "1995-05-01", offMode: "VARIABLE", fixedOffDays: [],
        offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [],
      }],
    };
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(escalaInputSchema.safeParse({ ...input, startDate: "1995-05-01", endDate: "1995-05-07" }).success).toBe(false);
    input.employees[0].activeFrom = "1899-12-31";
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
  });
  it("never accepts a permissive seventh-day configuration", () => {
    const input = empty();
    input.policy.maxConsecutiveWorkDays = 7;
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    input.policy.maxConsecutiveWorkDays = 6;
    input.policy.minInterShiftMinutes = 659;
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
  });
  it("rejects duplicate ids, impossible shifts and unresolved references", () => {
    const shift = { id: "s", name: "Turno", segments: [{ start: 480, end: 720, kind: "WORK" }] };
    expect(escalaInputSchema.safeParse({ ...empty(), shifts: [shift, shift] }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...empty(), shifts: [{ ...shift, segments: [{ start: 480, end: 479, kind: "WORK" }] }] }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...empty(), assignments: [{ employeeId: "missing", date: "2026-10-26", kind: "WORK", shiftId: "s" }] }).success).toBe(false);
  });
  it("rejects shift metadata on absences and overnight-only reference offsets", () => {
    expect(escalaInputSchema.safeParse({ ...empty(), assignments: [{ employeeId: "missing", date: "2026-10-26", kind: "ABSENCE", shiftId: "s" }] }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...empty(), shifts: [{ id: "s", name: "Turno", segments: [{ start: 1440, end: 1500, kind: "WORK" }] }] }).success).toBe(false);
  });
});

describe("calendar arithmetic and canonical presentation", () => {
  it("keeps dates independent of host timezone and month/year transitions", () => {
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("1900-02-29")).toBe(false);
    expect(isDate("1995-05-01")).toBe(true);
    expect(addDays("1999-12-31", 1)).toBe("2000-01-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayOfWeek("2026-10-26")).toBe(0);
    expect(dayOfWeek("2026-11-01")).toBe(6);
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(dateRange("2026-10-31", "2026-11-01")).toEqual(["2026-10-31", "2026-11-01"]);
    expect(absoluteMinute("2026-11-01", 480) - absoluteMinute("2026-10-30", 1380)).toBe(1980);
  });
  it("sorts branches naturally and groups sector, role and names without merging homonyms", () => {
    const branches = [{ branchCode: "10" }, { branchCode: "2" }, { branchCode: "1" }];
    expect(branches.sort(compareBranches).map((branch) => branch.branchCode)).toEqual(["1", "2", "10"]);
    const people = [
      { id: "3", sector: "Reposição", role: "Repositor", name: "Ána", registration: "0003" },
      { id: "2", sector: "Açougue", role: "Açougueiro", name: "Zé", registration: "0002" },
      { id: "1", sector: "Reposição", role: "Repositor", name: "ANA", registration: "0001" },
    ];
    expect(sortEmployees(people).map((person) => person.id)).toEqual(["2", "1", "3"]);
    expect(people[0].id).toBe("3");
  });
});
