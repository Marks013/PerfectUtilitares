import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "@/lib/escalas/schema";
import type { EscalaEmployee, EscalaShift } from "@/lib/escalas/types";
import {
  addDate,
  changeBranchWeeklyHours,
  changeContinuousWorkLimit,
  coverageDefinitionChanged,
  scenarioDefinitionChanged,
  hasOutdatedResults,
  clock,
  datesBetween,
  isCurrentResponse,
  mergeImport,
  monthPeriod,
  newEmployee,
  newInput,
  parseClock,
  replaceAssignment,
  responseMessage,
  selectNormativeProfile,
} from "./workspace-model";

function employee(registration: string): EscalaEmployee {
  return {
    ...newEmployee(42, "turno-inicial"),
    registration,
    name: `Pessoa ${registration}`,
    sector: "Reposição",
    role: "Repositor",
    activeFrom: "2020-01-01",
  };
}

describe("Escalas workspace model", () => {
  it("toggles the default-on work-block preference and invalidates scenario and coverage without changing imported data", () => {
    const input = newInput("07", "Hiper", "2026-11", 42);
    delete input.policy.limitContinuousWorkBlocks;
    input.employees = [employee("one")];
    input.assignments = [{ employeeId: input.employees[0].id, date: "2026-11-02", kind: "WORK", shiftId: input.shifts[0].id, locked: true }];
    expect(changeContinuousWorkLimit(input, true)).toBe(input);
    const off = changeContinuousWorkLimit(input, false);
    expect(off.policy.limitContinuousWorkBlocks).toBe(false);
    expect(off.defaultWeeklyHours).toBe(42);
    expect(off.employees).toBe(input.employees);
    expect(off.shifts).toBe(input.shifts);
    expect(off.assignments).toBe(input.assignments);
    expect(off.policy.allowShortMealSimulation).toBe(input.policy.allowShortMealSimulation);
    expect(scenarioDefinitionChanged(input, off)).toBe(true);
    expect(coverageDefinitionChanged(input, off)).toBe(true);
    const on = changeContinuousWorkLimit(off, true);
    expect(on.policy.limitContinuousWorkBlocks).toBe(true);
    expect(scenarioDefinitionChanged(off, on)).toBe(true);
    expect(coverageDefinitionChanged(off, on)).toBe(true);
  });
  it("uses one scenario journey and discards stale estimates without changing original references or explicit constraints", () => {
    const input = newInput("02", "Centro", "2026-11", 44);
    input.employees = [
      { ...employee("one"), weeklyHours: 44, weeklyHoursMode: "BRANCH", sourceSchedule: { report: "FPRE136", code: "old", description: "Original", weekday: "08:00-12:00 / 13:00-17:48", saturday: "08:00-12:00" } },
      { ...employee("two"), weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL" },
    ];
    input.demands = [
      { id: "estimate", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 2, estimated: true },
      { id: "confirmed", sector: "Reposição", date: "2026-11-02", start: 540, end: 600, minimum: 1 },
    ];
    input.assignments = [{ employeeId: input.employees[0].id, date: "2026-11-02", kind: "OFF", locked: true }];
    const next = changeBranchWeeklyHours(input, 42);
    expect(next.defaultWeeklyHours).toBe(42);
    expect(next.employees.map(person => person.weeklyHours)).toEqual([42, 40]);
    expect(next.demands).toEqual([input.demands[1]]);
    expect(next.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(next.assignments).toEqual(input.assignments);
    expect(input.defaultWeeklyHours).toBe(44);
  });

  it("invalidates planning outputs after hours, team or constraints change but not after manual day editing", () => {
    const input = newInput("02", "Centro", "2026-11", 44);
    expect(scenarioDefinitionChanged(input, structuredClone(input))).toBe(false);
    expect(scenarioDefinitionChanged(input, { ...input, defaultWeeklyHours: 42 })).toBe(true);
    expect(coverageDefinitionChanged(input, { ...input, defaultWeeklyHours: 42 })).toBe(true);
    expect(scenarioDefinitionChanged(input, { ...input, policy: { ...input.policy, closedDates: ["2026-11-03"] } })).toBe(true);
    expect(scenarioDefinitionChanged(input, { ...input, assignments: [{ employeeId: "one", date: "2026-11-02", kind: "OFF" }] })).toBe(false);
    const previous = { ...input, defaultWeeklyHours: 42 as const, employees: [{ ...employee("one"), id: "one", weeklyHours: 42 as const }], assignments: [{ employeeId: "one", date: "2026-11-02", kind: "WORK" as const, shiftId: input.shifts[0].id }] };
    const validation = { valid: false, readyToPublish: false, summaries: [], minimumCoverageMargin: null, issues: [{ code: "WEEKLY_MINUTES", severity: "ERROR" as const, message: "Old target" }] };
    expect(hasOutdatedResults(previous, validation)).toBe(true);
    expect(hasOutdatedResults({ ...previous, defaultWeeklyHours: 44, employees: [{ ...previous.employees[0], weeklyHours: 44 }] }, validation)).toBe(false);
    expect(hasOutdatedResults(input, null)).toBe(false);
  });
  it.each([
    [40, 480],
    [42, 504],
    [44, 528],
  ] as const)("creates the %ih template using %i exact minutes without certifying a policy", (hours, expected) => {
    const input = newInput(" 02 ", " Centro ", "2026-10", hours);
    expect(input.branchCode).toBe("02");
    expect(input.branchName).toBe("Centro");
    expect(input.defaultWeeklyHours).toBe(hours);
    expect(input.policy.reviewed).toBe(false);
    expect(input.policy.compensationAuthorized).toBe(false);
    expect(input.policy.nightWorkReviewed).toBe(false);
    expect(
      input.shifts[0].segments
        .filter((segment) => segment.kind !== "BREAK")
        .reduce((sum, segment) => sum + segment.end - segment.start, 0),
    ).toBe(expected);
    expect(input.employees).toEqual([]);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });

  it("expands the month to full Monday–Sunday weeks, including both boundaries", () => {
    expect(monthPeriod("2026-10")).toEqual({
      startDate: "2026-09-28",
      endDate: "2026-11-01",
    });
    expect(monthPeriod("2026-08")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-09-06",
    });
    expect(datesBetween("2026-07-27", "2026-09-06")).toHaveLength(42);
  });

  it("does date arithmetic across years without the workstation timezone", () => {
    expect(addDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it.each(["", "2026-13", "2026-00", "26-10", "1999-12", "2000-01", "2099-12", "2100-01"])(
    "rejects an invalid month: %s",
    (month) => {
      expect(() => monthPeriod(month)).toThrow();
    },
  );

  it("preserves exact minute displays and explicit next-day offsets", () => {
    expect(clock(504)).toBe("08:24");
    expect(clock(528)).toBe("08:48");
    expect(parseClock("25:15")).toBe(1515);
    expect(clock(parseClock("25:15"))).toBe("25:15");
  });

  it.each(["8:24", "08:60", "49:00", "48:01", "8.24", "-1:00"])(
    "rejects malformed or out-of-bound clock input: %s",
    (value) => {
      expect(() => parseClock(value)).toThrow();
    },
  );

  it("leaves optional admission and history empty and uses protective Sundays for a new person", () => {
    const result = newEmployee(40, "horario-40");
    expect(result.activeFrom).toBe("");
    expect(result.historyKnown).toBe(false);
    expect(result.history).toEqual([]);
    expect(result.maxConsecutiveSundays).toBe(1);
    expect(result.sundayRestRule).toBe("PROTECTIVE");
    expect(result.weeklyHours).toBe(40);
    expect(result.shiftIds).toEqual(["horario-40"]);
  });

  it.each([
    ["2026-12", 44, [528, 504]],
    ["2027-12", 42, [504, 480]],
    ["2028-01", 44, [480]],
    ["2026-12", 40, [480]],
  ] as const)(
    "prepares exact shift alternatives for %s without increasing a %ih contract",
    (month, hours, expected) => {
      const input = newInput("2", "Centro", month, hours);
      const minutes = input.shifts.map((shift) =>
        shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0),
      );
      expect(minutes).toEqual(expected);
      expect(input.shifts[0].id).toBe("turno-inicial");
      expect(input.defaultWeeklyHours).toBe(hours);
      expect(input.policy.transitionWeekAccepted).toBe(false);
      expect(input.policy.collectiveAgreement).toBeUndefined();
      expect(input.policy.normativeProfile).toBe("CUSTOM");
      expect(escalaInputSchema.safeParse(input).success).toBe(true);
    },
  );

  it("keeps every selected initial shift for the transition without sharing mutable arrays", () => {
    const shifts = ["turno-inicial", "turno-inicial-40h"];
    const result = newEmployee(42, shifts);
    expect(result.shiftIds).toEqual(shifts);
    result.shiftIds.push("outro");
    expect(shifts).toHaveLength(2);
    expect(result.sundayRestRule).toBe("PROTECTIVE");
  });

  it("selects the CCT without changing contracts, shifts or closures and requires fresh evidence review", () => {
    const input = newInput("2", "Centro", "2026-10", 40);
    input.employees = [employee("0001")];
    input.policy.closedDates = ["2026-10-30"];
    input.policy.reviewed = true;
    input.policy.collectiveAgreement = {
      source: "Instrumento anterior",
      validFrom: "2026-01-01",
      validUntil: "2027-12-31",
      reviewedBy: "Responsável",
      reviewed: true,
    };
    input.policy.operationalCertificate = {
      identifier: "Certidão anterior",
      validFrom: "2026-01-01",
      validUntil: "2027-12-31",
      reviewedBy: "Responsável",
      reviewed: true,
      sundays: true,
      holidays: false,
      after20: false,
    };
    const selected = selectNormativeProfile(input, "SINDECOMU_SUPERMARKETS_2026_2027");
    expect(selected.policy).toMatchObject({
      source: expect.stringContaining("PR003084/2026"),
      validFrom: "2026-06-01",
      validUntil: "2027-05-31",
      reviewed: false,
      holidayRestAllowed: false,
      maxConsecutiveWorkDays: 5,
    });
    expect(selected.policy.collectiveAgreement).toMatchObject({ source: "Instrumento anterior", reviewed: false });
    expect(selected.policy.operationalCertificate).toMatchObject({
      identifier: "Certidão anterior",
      sundays: true,
      reviewed: false,
    });
    expect(selected.employees).toEqual(input.employees);
    expect(selected.shifts).toEqual(input.shifts);
    expect(selected.policy.closedDates).toEqual(["2026-10-30"]);
    expect(input.policy.reviewed).toBe(true);
    expect(input.policy.collectiveAgreement.reviewed).toBe(true);
    const custom = selectNormativeProfile(selected, "CUSTOM");
    expect(custom.policy.source).toBe(selected.policy.source);
    expect(custom.policy.validFrom).toBe(selected.policy.validFrom);
    expect(custom.policy.reviewed).toBe(false);
  });

  it("replaces only the selected person and date, preserving locked decisions elsewhere", () => {
    const before = [
      {
        employeeId: "a",
        date: "2026-10-01",
        kind: "WORK" as const,
        shiftId: "x",
      },
      {
        employeeId: "b",
        date: "2026-10-01",
        kind: "WORK" as const,
        shiftId: "x",
        locked: true,
      },
      { employeeId: "a", date: "2026-10-02", kind: "OFF" as const },
    ];
    const after = replaceAssignment(before, {
      employeeId: "a",
      date: "2026-10-01",
      kind: "OFF",
    });
    expect(after).toHaveLength(3);
    expect(after).toContainEqual(before[1]);
    expect(after).toContainEqual(before[2]);
    expect(before[0].kind).toBe("WORK");
  });

  it("adds an import without replacing existing people or duplicating an identical shift", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    input.employees = [employee("0001")];
    const added = employee("0002");
    const result = mergeImport(input, [added], [input.shifts[0]]);
    expect(result.employees.map((person) => person.registration)).toEqual(["0001", "0002"]);
    expect(result.shifts).toHaveLength(1);
    expect(input.employees).toHaveLength(1);
  });

  it("rejects a colliding registration instead of silently updating a person", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    input.employees = [employee("0001")];
    expect(() => mergeImport(input, [employee("0001")], [])).toThrow("matrícula já cadastrada");
    expect(input.employees).toHaveLength(1);
  });

  it("rejects a shift identifier with different hours without mutating the proposal", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    const conflicting: EscalaShift = {
      ...input.shifts[0],
      segments: [{ start: 480, end: 960, kind: "WORK" }],
    };
    expect(() => mergeImport(input, [], [conflicting])).toThrow("configuração diferente");
    expect(input.shifts[0].segments).toHaveLength(3);
  });

  it("does not allow duplicate registrations within one preview", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    expect(() => mergeImport(input, [employee("0001"), employee("0001")], [])).toThrow("matrícula já cadastrada");
  });

  it("accepts a 200-person branch in one import and rejects more than 250 without mutation", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    const people = Array.from({ length: 250 }, (_, index) => employee(String(index + 1)));
    expect(mergeImport(input, people.slice(0, 200), []).employees).toHaveLength(200);
    expect(mergeImport(input, people, []).employees).toHaveLength(250);
    expect(() => mergeImport(input, [...people, employee("251")], [])).toThrow("250 colaboradores");
    expect(input.employees).toHaveLength(0);
  });

  it("extracts structured errors without exposing raw server payloads", () => {
    expect(
      responseMessage({
        error: { code: "STALE", message: "Revisão alterada" },
      }),
    ).toBe("Revisão alterada");
    expect(responseMessage({ error: "Acesso negado" })).toBe("Acesso negado");
    expect(responseMessage(null)).toBe("Resposta inválida do servidor.");
  });

  it("ignores a late response after cancellation even if the underlying operation completes", async () => {
    const controller = new AbortController();
    let currentVersion = 1;
    const responseVersion = currentVersion;
    let resolve: (value: string) => void = () => undefined;
    const response = new Promise<string>((done) => {
      resolve = done;
    });
    const applied: string[] = [];
    const operation = response.then((value) => {
      if (isCurrentResponse(controller.signal, responseVersion, currentVersion)) applied.push(value);
    });
    currentVersion += 1;
    controller.abort();
    resolve("resultado antigo");
    await operation;
    expect(applied).toEqual([]);
    expect(isCurrentResponse(new AbortController().signal, currentVersion, currentVersion)).toBe(true);
    expect(isCurrentResponse(new AbortController().signal, responseVersion, currentVersion)).toBe(false);
  });
  it("invalidates the scenario and coverage when absence days change, but not when only work/off cells change", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const manual = { ...input, assignments: [{ employeeId: "a", date: "2026-11-04", kind: "OFF" as const }] };
    expect(scenarioDefinitionChanged(input, manual)).toBe(false);
    expect(coverageDefinitionChanged(input, manual)).toBe(false);
    const absent = { ...manual, assignments: [{ employeeId: "a", date: "2026-11-04", kind: "ABSENCE" as const }] };
    expect(scenarioDefinitionChanged(manual, absent)).toBe(true);
    expect(coverageDefinitionChanged(manual, absent)).toBe(true);
    expect(scenarioDefinitionChanged(absent, { ...absent, assignments: [...absent.assignments].reverse() })).toBe(false);
    expect(coverageDefinitionChanged(absent, { ...absent, assignments: absent.assignments.map((item) => ({ ...item, locked: true })) })).toBe(false);
  });

  it("retains an explicit regeneration requirement after JSON save and reload without weekly errors", () => {
    const input = { ...newInput("02", "Centro", "2026-11", 42), needsRegeneration: true };
    const reopened = JSON.parse(JSON.stringify(input));
    expect(escalaInputSchema.safeParse(reopened).success).toBe(true);
    expect(hasOutdatedResults(reopened, null)).toBe(true);
    expect(hasOutdatedResults({ ...reopened, needsRegeneration: false }, null)).toBe(false);
  });

});
