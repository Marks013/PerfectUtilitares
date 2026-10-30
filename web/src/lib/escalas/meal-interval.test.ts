import { describe, expect, it } from "vitest";
import { dateRange, dayOfWeek } from "./dates";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";
import { validateEscala } from "./validation";
import { validateJourney, workJourney } from "./validation-time";

function fixture(mealMinutes = 120): EscalaInput {
  const startDate = "2026-11-02", endDate = "2026-11-08";
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial 02", startDate, endDate,
    defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: { source: "Referência de teste", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: true,
      reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
      closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: [{ id: "p", registration: "1", name: "Pessoa", sector: "Caixa", role: "Operador", weeklyHours: 40,
      shiftIds: ["s"], activeFrom: startDate, offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY",
      maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: false, history: [] }],
    shifts: [{ id: "s", name: "Diurno", segments: [ { start: 360, end: 600, kind: "WORK" },
      { start: 600, end: 600 + mealMinutes, kind: "BREAK" },
      { start: 600 + mealMinutes, end: 840 + mealMinutes, kind: "WORK" } ] }],
    demands: dateRange(startDate, endDate).map((date) => ({ id: "d-" + date, date, sector: "Caixa", start: 360, end: 600, minimum: dayOfWeek(date) < 5 ? 1 : 0 })),
    assignments: dateRange(startDate, endDate).map((date) => dayOfWeek(date) < 5
      ? { employeeId: "p", date, kind: "WORK", shiftId: "s" } : { employeeId: "p", date, kind: "OFF" }),
  };
}

const agreement = () => ({ source: "Acordo específico de intervalo", validFrom: "2026-11-02", validUntil: "2026-11-08",
  reviewedBy: "Responsável pela conferência", reviewed: true, maximumMinutes: 240 });
const mealIssues = (input: EscalaInput) => validateJourney(input, workJourney(input.assignments[0], input.shifts[0]))
  .filter((issue) => issue.code === "MEAL_INTERVAL_EXCESSIVE");

describe("extended unpaid meal intervals", () => {
  it("retains legacy policies without an exception and accepts exactly 120 minutes", () => {
    const input = fixture();
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(mealIssues(input)).toEqual([]);
    expect(validateEscala(input).readyToPublish).toBe(true);
  });

  it.each([121, 240])("rejects an unsubstantiated %s-minute meal outside simulation", (minutes) => {
    const input = fixture(minutes);
    const before = structuredClone(input);
    expect(mealIssues(input)).toEqual([expect.objectContaining({ code: "MEAL_INTERVAL_EXCESSIVE", severity: "ERROR", employeeId: "p", date: input.startDate })]);
    expect(mealIssues(input)[0].message).toContain(String(minutes));
    expect(mealIssues(input)[0].message).toContain("120 minutos");
    expect(input).toEqual(before);
  });

  it("keeps a long-meal simulation valid but pending, with the source schedule intact", () => {
    const input = { ...fixture(240), simulation: true };
    const before = structuredClone(input);
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues.filter((issue) => issue.code === "MEAL_INTERVAL_EXCESSIVE")).toHaveLength(5);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MEAL_INTERVAL_EXCESSIVE", severity: "PENDING" }));
    expect(mealIssues(input)[0].message).toMatch(/ajuste|Ajuste/);
    expect(input).toEqual(before);
  });

  it("accepts only the reviewed, specific agreement within its validity and limit", () => {
    const input = fixture(240);
    input.policy.mealIntervalAgreement = agreement();
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(mealIssues(input)).toEqual([]);
    expect(validateEscala(input).readyToPublish).toBe(true);
    input.policy.mealIntervalAgreement.maximumMinutes = 239;
    expect(mealIssues(input)).toHaveLength(1);
  });

  it.each([
    { reviewed: false }, { source: " " }, { reviewedBy: " " },
    { validUntil: "2026-11-01" }, { validFrom: "2026-11-03" },
  ])("does not infer authorization from incomplete, expired or unreviewed evidence: %j", (change) => {
    const input = fixture(240);
    input.policy.mealIntervalAgreement = { ...agreement(), ...change };
    expect(mealIssues(input)).toEqual([expect.objectContaining({ severity: "ERROR" })]);
  });

  it("does not treat an unrelated collective agreement as a meal exception", () => {
    const input = fixture(240);
    input.policy.collectiveAgreement = agreement();
    expect(mealIssues(input)).toHaveLength(1);
  });

  it("checks the actual journey date across expiry, not only the start of the plan", () => {
    const input = fixture(240);
    input.policy.mealIntervalAgreement = { ...agreement(), validUntil: "2026-11-02" };
    const result = validateEscala(input);
    expect(result.issues.filter((issue) => issue.code === "MEAL_INTERVAL_EXCESSIVE").map((issue) => issue.date))
      .toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(result.valid).toBe(false);
    expect(result.readyToPublish).toBe(false);
  });

  it("revalidates generated work assignments rather than trusting a feasible status", () => {
    const input = fixture(240);
    const assignments = structuredClone(input.assignments);
    const result = validateEscala({ ...input, assignments });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.code === "MEAL_INTERVAL_EXCESSIVE")).toHaveLength(5);
  });

  it("does not apply the over-six-hour ceiling to a journey of exactly six paid hours", () => {
    const input = fixture(240);
    input.shifts[0].segments[2].end -= 120;
    expect(mealIssues(input)).toEqual([]);
    input.shifts[0].segments[2].end += 1;
    expect(mealIssues(input)).toHaveLength(1);
  });

  it("requires integer, bounded exception limits and ordered validity", () => {
    const parse = (value: Record<string, unknown>) => {
      const input = fixture();
      return escalaInputSchema.safeParse({ ...input, policy: { ...input.policy, mealIntervalAgreement: { ...agreement(), ...value } } }).success;
    };
    for (const maximumMinutes of [120, 240.5, 361]) expect(parse({ maximumMinutes })).toBe(false);
    for (const maximumMinutes of [121, 240, 360]) expect(parse({ maximumMinutes })).toBe(true);
    expect(parse({ validFrom: "2026-11-09", validUntil: "2026-11-08" })).toBe(false);
    expect(parse({ extraAuthorization: true })).toBe(false);
  });

  it("does not count paid pauses as an unpaid meal or silently change short-pause flexibility", () => {
    const input = fixture(240);
    input.shifts[0].segments[1].kind = "PAID_BREAK";
    expect(mealIssues(input)).toEqual([]);
    expect(validateJourney(input, workJourney(input.assignments[0], input.shifts[0])).some((issue) => issue.code === "MEAL_INTERVAL")).toBe(true);
  });
});
