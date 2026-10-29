import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { certificateAuthorizes, collectiveExtensionAuthorized, effectiveSundayLimit, effectiveWeeklyHours, legalWeeklyHours, transitionWeeks } from "./labor-rules";
import { prepareRoster, proposeCoverage } from "./preparation";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import { exportEscalaXlsx } from "./export";
import type { EscalaInput } from "./types";

function fixture(startDate = "2026-11-02", hours: 40 | 42 | 44 = 42): EscalaInput {
  const daily = effectiveWeeklyHours({ weeklyHours: hours }, startDate) * 12;
  const endDate = addDays(startDate, 6);
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial de teste", startDate, endDate, defaultWeeklyHours: hours, timeZone: "America/Sao_Paulo",
    policy: { source: "Norma do cenário", validFrom: "2026-01-01", validUntil: "2029-12-31", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44,
      dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6,
      closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false,
      collectiveAgreement: { source: "Acordo do cenário", validFrom: "2026-12-16", validUntil: "2027-12-15", reviewed: true, reviewedBy: "Responsável" } },
    employees: [{ id: "p1", registration: "0001", name: "Pessoa de teste", sector: "Setor", role: "Cargo", weeklyHours: hours, shiftIds: ["day"], activeFrom: "",
      offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE", preferredOffDays: [], historyKnown: false, history: [] }],
    shifts: [{ id: "day", name: "Referência", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 780 + daily - 240, kind: "WORK" }] }],
    assignments: dateRange(startDate, endDate).map((date) => ({ employeeId: "p1", date, kind: dayOfWeek(date) < 5 ? "WORK" as const : "OFF" as const, ...(dayOfWeek(date) < 5 ? { shiftId: "day" } : {}) })),
    demands: dateRange(startDate, endDate).map((date) => ({ id: `d${date}`, date, sector: "Setor", start: 420, end: 660, minimum: dayOfWeek(date) < 5 ? 1 : 0 })),
  };
}

const paid = (input: EscalaInput, id: string) => {
  const shift = input.shifts.find((entry) => entry.id === id);
  if (!shift) throw new Error("Horário esperado ausente");
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
};

describe("dated legal limits and one-file planning", () => {
  it.each([["2026-12-15", 44], ["2026-12-16", 42], ["2027-12-15", 42], ["2027-12-16", 40]] as const)("uses the weekly ceiling on %s", (day, hours) => {
    expect(legalWeeklyHours(day)).toBe(hours);
    expect(effectiveWeeklyHours({ weeklyHours: 40 }, day)).toBe(40);
  });
  it("supports unknown admission and optional history without inventing an employment date or past rest", () => {
    const input = fixture();
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    const result = validateEscala(input);
    expect(result.readyToPublish).toBe(true);
    expect(result.issues).toEqual([expect.objectContaining({ code: "HISTORY_UNVERIFIED", severity: "WARNING" })]);
    expect(input.employees[0].activeFrom).toBe("");
    expect(input.employees[0].history).toEqual([]);
  });
  it.each(["2026-12-14", "2027-12-13"])("requires deliberate whole-week adoption on transition week %s", (start) => {
    const input = fixture(start, 44);
    expect(transitionWeeks(input)).toEqual([start]);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "TRANSITION_WEEK_PENDING" }));
    input.policy.transitionWeekAccepted = true;
    expect(validateEscala(input).readyToPublish).toBe(true);
  });
  it("does not mistake an unsigned, incomplete or expired document for an authorization", () => {
    const policy = fixture().policy;
    const agreement = policy.collectiveAgreement;
    if (!agreement) throw new Error("Acordo do cenário ausente");
    expect(collectiveExtensionAuthorized(policy, "2027-02-01")).toBe(true);
    agreement.validFrom = "";
    expect(escalaInputSchema.safeParse({ ...fixture(), policy }).success).toBe(true);
    expect(collectiveExtensionAuthorized(policy, "2027-02-01")).toBe(false);
    agreement.validFrom = "2026-12-16";
    agreement.reviewed = false;
    expect(collectiveExtensionAuthorized(policy, "2027-02-01")).toBe(false);
    expect(collectiveExtensionAuthorized(policy, "2027-12-16")).toBe(false);
  });
  it("keeps art.386 protection even if a client sends a numeric cap of two", () => {
    const person = fixture().employees[0];
    person.maxConsecutiveSundays = 2;
    person.sundayRestRule = "CLT_386";
    expect(effectiveSundayLimit(person)).toBe(1);
    person.sundayRestRule = "PROTECTIVE";
    expect(effectiveSundayLimit(person)).toBe(1);
    person.sundayRestRule = "COMMERCE";
    expect(effectiveSundayLimit(person)).toBe(2);
  });
  it("does not extend a CCT by editing its policy dates and does not accept a generic certificate", () => {
    const input = fixture("2027-06-07", 40);
    input.policy.normativeProfile = "SINDECOMU_SUPERMARKETS_2026_2027";
    input.policy.holidayRestAllowed = false;
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CCT_VALIDITY" }));
    expect(certificateAuthorizes(input.policy, "2026-11-08", "sundays")).toBe(false);
    input.policy.operationalCertificate = { identifier: "CERT-TESTE", validFrom: "2026-06-01", validUntil: "2027-05-31", reviewed: true, reviewedBy: "Responsável", sundays: true, holidays: false, after20: false };
    expect(certificateAuthorizes(input.policy, "2026-11-08", "sundays")).toBe(true);
    expect(certificateAuthorizes(input.policy, "2026-11-08", "holidays")).toBe(false);
    expect(certificateAuthorizes(input.policy, "2027-06-06", "sundays")).toBe(false);
  });
  it("checks the planned history without converting it to actual attendance", () => {
    const input = fixture("2026-11-02", 40);
    input.employees[0].planningHistory = dateRange("2026-10-27", "2026-11-01").map((date) => ({ employeeId: "p1", date, kind: "WORK", shiftId: "day" }));
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK", date: input.startDate }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_UNVERIFIED", severity: "WARNING" }));
    expect(input.employees[0].historyKnown).toBe(false);
    expect(input.employees[0].history).toEqual([]);
  });
});

describe("branch-wide proposal preparation", () => {
  it("adapts 7h20 reference to exact 8h24, preserving meals, source and either endpoint", () => {
    const input = fixture();
    input.shifts[0].segments[2].end = 980;
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00 / 13:00-16:20" };
    const original = structuredClone(input);
    const prepared = prepareRoster(input, 42);
    expect(prepared.employees[0].shiftIds).toHaveLength(2);
    expect(prepared.employees[0].shiftIds.map((id) => paid(prepared, id))).toEqual([504, 504]);
    expect(prepared.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(prepared.assignments).toEqual([]);
    expect(prepared.shifts.filter((shift) => shift.id.startsWith("prep-")).every((shift) => shift.segments[1].start === 660 && shift.segments[1].end === 780)).toBe(true);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
    expect(input).toEqual(original);
  });
  it("leaves undefined and short original journeys outside generation until a branch default is explicitly chosen", () => {
    const input = fixture();
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "0011", description: "NÃO SUBORDINADO A HORÁRIO", weekday: "00:00-00:00", saturday: "00:00-00:00" };
    input.employees[0].shiftIds = [];
    input.employees[0].planningEnabled = false;
    expect(prepareRoster(input, 42).employees[0].planningEnabled).toBe(false);
    expect(prepareRoster(input, 42, "BRANCH_DEFAULT").employees[0].planningEnabled).toBe(false);
    input.employees[0].planningEnabled = true;
    const included = prepareRoster(input, 42, "BRANCH_DEFAULT");
    expect(included.employees[0].planningEnabled).toBe(true);
    expect(paid(included, included.employees[0].shiftIds[0])).toBe(504);
    input.employees[0].shiftIds = ["day"];
    input.shifts[0].segments = [{ start: 420, end: 660, kind: "WORK" }];
    expect(prepareRoster(input, 42).employees[0].planningEnabled).toBe(false);
  });
  it.each([["PRESERVE_START", 420, 1044], ["PRESERVE_END", 356, 980]] as const)("keeps the explicitly selected %s strategy with the original unpaid meal", (strategy, start, end) => {
    const input = fixture();
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" };
    const prepared = prepareRoster(input, 42, "EXCLUDE", strategy);
    expect(prepared.employees[0].shiftIds).toHaveLength(1);
    const shift = prepared.shifts.find((item) => item.id === prepared.employees[0].shiftIds[0]);
    expect(shift?.segments).toEqual([{ start, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end, kind: "WORK" }]);
    expect(paid(prepared, prepared.employees[0].shiftIds[0])).toBe(504);
    expect(input.employees[0].sourceSchedule.weekday).toBe("07:00-11:00 / 13:00-16:20");
  });
  it("does not move blocked assignments or erase absences", () => {
    const input = fixture(); input.assignments[0].locked = true;
    expect(() => prepareRoster(input, 40)).toThrow(/bloqueados/);
    input.assignments[0] = { employeeId: "p1", date: input.startDate, kind: "ABSENCE" };
    expect(prepareRoster(input, 40).assignments).toEqual([input.assignments[0]]);
  });
  it("preserves explicit exclusions and Sunday classifications when adapting hours", () => {
    const input = fixture();
    input.employees[0].sundayRestRule = "COMMERCE";
    input.employees[0].maxConsecutiveSundays = 2;
    input.employees[0].offMode = "MIXED"; input.employees[0].fixedOffDays = [2];
    input.employees.push({ ...structuredClone(input.employees[0]), id: "excluded", registration: "0002", planningEnabled: false, scheduleMode: "UNTIMED", shiftIds: [] });
    const prepared = prepareRoster(input, 40, "BRANCH_DEFAULT");
    expect(prepared.employees[0]).toMatchObject({ sundayRestRule: "COMMERCE", maxConsecutiveSundays: 2, offMode: "MIXED", fixedOffDays: [2] });
    expect(prepared.employees[1]).toEqual(input.employees[1]);
  });
  it("preserves a shorter contract and rebuilds imported proposals from their original reference on repeated setup", () => {
    const shorter = prepareRoster(fixture("2026-11-02", 40), 42);
    expect(shorter.employees[0].weeklyHours).toBe(40);
    expect(shorter.employees[0].shiftIds.every((id) => paid(shorter, id) === 480)).toBe(true);
    const input = fixture();
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" };
    const first = prepareRoster(input, 42);
    expect(prepareRoster(first, 42).employees[0].shiftIds).toEqual(first.employees[0].shiftIds);
  });
  it("allows 42 to 40 to 42 for a branch reference while preserving explicit and ambiguous shorter contracts", () => {
    const input = fixture();
    input.assignments = [];
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" };
    input.employees.push({ ...structuredClone(input.employees[0]), id: "individual", registration: "0002", weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL" });
    input.employees.push({ ...structuredClone(input.employees[0]), id: "legacy-shorter", registration: "0003", weeklyHours: 40 });
    const shorter = prepareRoster(input, 40);
    expect(shorter.employees.map((person) => person.weeklyHours)).toEqual([40, 40, 40]);
    expect(shorter.employees[0].weeklyHoursMode).toBe("BRANCH");
    // Keep the ambiguous legacy shorter reference individual when first adapting it.
    expect(shorter.employees[2].weeklyHoursMode).toBe("INDIVIDUAL");
    const restored = prepareRoster(shorter, 42);
    expect(restored.employees.map((person) => person.weeklyHours)).toEqual([42, 40, 40]);
    expect(restored.employees[0].shiftIds.every((id) => paid(restored, id) === 504)).toBe(true);
    expect(restored.employees.slice(1).every((person) => person.shiftIds.every((id) => paid(restored, id) === 480))).toBe(true);
  });
  it("retains excluded people for auditing without demanding a nonexistent schedule", () => {
    const input = fixture();
    input.employees.push({ ...structuredClone(input.employees[0]), id: "off", registration: "0002", planningEnabled: false, shiftIds: [] });
    expect(validateEscala(input).readyToPublish).toBe(true);
    input.assignments.push({ employeeId: "off", date: input.startDate, kind: "OFF" });
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "DISABLED_ASSIGNMENT" }));
  });
  it("includes a manager without fixed hours in 5x2 rest rotation without inventing hours or coverage", () => {
    const input = fixture();
    input.employees[0].scheduleMode = "UNTIMED";
    input.employees[0].shiftIds = [];
    input.shifts = []; input.demands = [];
    input.assignments = input.assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: item.kind === "WORK" ? "DUTY" : item.kind }));
    const result = validateEscala(input);
    expect(result.readyToPublish).toBe(true);
    expect(result.summaries[0]).toMatchObject({ workDays: 5, offDays: 2, workedMinutes: 0 });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNTIMED_REST_UNVERIFIED", severity: "WARNING" }));
    const prepared = prepareRoster({ ...input, assignments: [] }, 42, "BRANCH_DEFAULT");
    expect(prepared.employees[0]).toMatchObject({ scheduleMode: "UNTIMED", planningEnabled: true, shiftIds: [] });
    expect(prepared.shifts).toEqual([]);
    expect(proposeCoverage(prepared).demands).toEqual([]);
    input.demands = [{ id: "cannot-count-manager", date: input.startDate, sector: "Setor", start: 420, end: 660, minimum: 1 }];
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_DEFICIT" }));
  });
  it("does not permit seven consecutive untimed workdays or two worked Sundays under the protective default", () => {
    const input = fixture();
    input.employees[0].scheduleMode = "UNTIMED"; input.employees[0].shiftIds = [];
    input.shifts = []; input.demands = [];
    input.assignments = input.assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: "DUTY" }));
    input.employees[0].planningHistory = [{ employeeId: "p1", date: "2026-11-01", kind: "DUTY" }];
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "SUNDAY_ROTATION" }));
    expect(result.readyToPublish).toBe(false);
  });
  it("suggests five days of provisional one-person coverage while preserving explicit ranges, not skipping the whole date", () => {
    const input = prepareRoster(fixture(), 42);
    input.demands = [{ id: "existing", date: input.startDate, sector: "Setor", start: 420, end: 660, minimum: 1 }];
    const original = structuredClone(input);
    const proposed = proposeCoverage(input);
    expect(proposed.demands.find((demand) => demand.id === "existing")).toEqual(input.demands[0]);
    const estimates = proposed.demands.filter((demand) => demand.estimated === true);
    expect(estimates.every((demand) => demand.role === "Cargo")).toBe(true);
    expect(estimates.some((demand) => demand.date === input.startDate && demand.start === 780 && demand.end === 1044)).toBe(true);
    expect(estimates.some((demand) => demand.date === input.startDate && demand.start < 660 && demand.end > 420)).toBe(false);
    const afternoon = estimates.filter((demand) => demand.start === 780);
    expect(afternoon).toHaveLength(7);
    expect(afternoon.reduce((sum, demand) => sum + demand.minimum, 0)).toBe(5);
    expect(afternoon.filter((demand) => demand.minimum === 0)).toHaveLength(2);
    expect(estimates.some((demand) => demand.start < 780 && demand.end > 660)).toBe(false);
    expect(proposed.policy.coverageReview).toBe("SUGGESTED");
    expect(validateEscala(proposed).issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING" }));
    expect(input).toEqual(original);
  });
  it("retains explicit minima and recalculates stale estimates even when the legacy global review says CONFIRMED", () => {
    const input = fixture();
    input.policy.coverageReview = "CONFIRMED";
    input.demands = [
      { id: "approved", date: input.startDate, sector: "Setor", start: 420, end: 660, minimum: 1, estimated: false },
      { id: "stale", date: input.startDate, sector: "Setor", start: 780, end: 980, minimum: 99, estimated: true },
    ];
    const original = structuredClone(input);
    const proposed = proposeCoverage(input);
    expect(proposed.policy.coverageReview).toBe("SUGGESTED");
    expect(proposed.demands.find((demand) => demand.id === "approved")).toEqual(input.demands[0]);
    expect(proposed.demands.some((demand) => demand.id === "stale")).toBe(false);
    expect(proposed.demands.filter((demand) => demand.id !== "approved").every((demand) => demand.estimated === true)).toBe(true);
    expect(proposed.demands.some((demand) => demand.end === 1044)).toBe(true);
    expect(input).toEqual(original);
  });
  it("uses a coherent opening reference and exactly twenty weekly staffing opportunities for four people", () => {
    const input = fixture(); input.assignments = []; input.demands = [];
    input.shifts[0].segments[2].end = 980;
    input.employees = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(input.employees[0]), id: `p${index}`, registration: `00${index}` }));
    const prepared = prepareRoster(input, 42);
    const demands = proposeCoverage(prepared).demands;
    expect(demands.every((demand) => demand.estimated === true && demand.role === "Cargo")).toBe(true);
    expect(demands.every((demand) => demand.start >= 420 && demand.end <= 1044)).toBe(true);
    const opening = demands.filter((demand) => demand.start === 420 && demand.end === 660);
    const closing = demands.filter((demand) => demand.start === 780 && demand.end === 1044);
    expect(opening).toHaveLength(7);
    expect(closing).toHaveLength(7);
    expect(opening.reduce((sum, demand) => sum + demand.minimum, 0)).toBe(20);
    expect(closing.reduce((sum, demand) => sum + demand.minimum, 0)).toBe(20);
    expect(opening.map((demand) => demand.minimum).sort()).toEqual([2, 3, 3, 3, 3, 3, 3]);
    expect(closing.map((demand) => demand.minimum)).toEqual(opening.map((demand) => demand.minimum));
  });
  it("exports effective weekly targets and the limits of verification", () => {
    const input = fixture("2028-01-03", 42);
    const validation = validateEscala(input);
    const bytes = exportEscalaXlsx({ id: "w", revision: 1, status: "DRAFT", input, validation, canEdit: true, canPublish: true, updatedAt: "2028-01-03" });
    const archive = unzipSync(bytes);
    expect(strFromU8(archive["xl/worksheets/sheet4.xml"])).toContain("Carga proposta nesta semana");
    expect(strFromU8(archive["xl/worksheets/sheet4.xml"])).toContain("<v>40</v>");
    expect(strFromU8(archive["xl/worksheets/sheet2.xml"])).toContain("Informação");
  });
});
