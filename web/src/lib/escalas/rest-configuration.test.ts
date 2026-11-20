import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { fixedRestConfigurationError, fixedRestProjection, fixedRestSlots, withFixedRestSlots } from "./fixed-rest";
import { applyBranchRestCalendar, variableRestGroups, variableRestIssues } from "./rest-configuration";
import { escalaInputSchema } from "./schema";
import { prepareGeneration } from "./generation";
import { generationScenarioBasis } from "./hours-reference";
import { validateEscala } from "./validation";
import { reconcileImport } from "@/components/escalas/import-reconciliation";
import type { EscalaInput } from "./types";

function fixture(branchCode = "06"): EscalaInput {
  const value = newInput(branchCode, "Filial sintética", "2026-12", 42);
  value.startDate = "2026-11-29"; value.endDate = "2026-12-26"; delete value.visibleMonth;
  value.restRulesVersion = 3; value.policy.calendarMode = "MANUAL";
  value.policy.compensationAuthorized = true;
  value.employees = [{ ...newEmployee(42), id: "synthetic", registration: "S-1", name: "Pessoa sintética",
    sector: "Sintético", role: "Função", activeFrom: "2020-01-01", shiftIds: [value.shifts[0].id] }];
  value.assignments = dateRange(value.startDate, value.endDate).map(date => ({ employeeId: "synthetic", date,
    kind: [2, 6].includes(dayOfWeek(date)) ? "OFF" as const : "WORK" as const,
    ...([2, 6].includes(dayOfWeek(date)) ? {} : { shiftId: value.shifts[0].id }) }));
  return value;
}

describe("explicit personal rest configuration", () => {
  it("projects all four enable combinations and preserves independent stored weekdays", () => {
    const employee = fixture().employees[0];
    for (const first of [false, true]) for (const second of [false, true]) {
      const slots = [{ enabled: first, weekday: 2 }, { enabled: second, weekday: 6 }] as const;
      const before = structuredClone(employee);
      const edited = withFixedRestSlots(employee, [{ ...slots[0] }, { ...slots[1] }]);
      expect(edited.fixedOffDays).toEqual([...(first ? [2] : []), ...(second ? [6] : [])]);
      expect(edited.offMode).toBe(first && second ? "FIXED" : first || second ? "MIXED" : "VARIABLE");
      expect(fixedRestSlots(edited)).toEqual(slots);
      expect(fixedRestConfigurationError(edited)).toBeUndefined();
      expect(employee).toEqual(before);
    }
  });
  it("rejects duplicate enabled weekdays, missing days, malformed slots and forged projection", () => {
    expect(() => fixedRestProjection([{ enabled: true, weekday: 2 }, { enabled: true, weekday: 2 }])).toThrow(/diferentes/);
    expect(() => fixedRestProjection([{ enabled: true, weekday: null }, { enabled: false, weekday: 6 }])).toThrow(/dia válido/);
    for (const slots of [null, [], [{ enabled: 1, weekday: 2 }, { enabled: false, weekday: 6 }]]) {
      expect(() => fixedRestProjection(slots as never)).toThrow();
    }
    const input = fixture(); input.employees[0] = withFixedRestSlots(input.employees[0], [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 6 }]);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    input.employees[0].fixedOffDays = [6];
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
  });
  it("preserves legacy fixed choices, disabled slots through JSON and import reconciliation", () => {
    const input = fixture(), original = input.employees[0];
    original.offMode = "MIXED"; original.fixedOffDays = [2];
    expect(fixedRestSlots(original)).toEqual([{ enabled: true, weekday: 2 }, { enabled: false, weekday: null }]);
    original.fixedRestSlots = [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 6 }];
    const restored = escalaInputSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(restored.employees[0].fixedRestSlots).toEqual(original.fixedRestSlots);
    const incoming = { ...newEmployee(42), ...original, name: "Nome atualizado", offMode: "VARIABLE" as const, fixedOffDays: [], fixedRestSlots: undefined };
    const reconciled = reconcileImport(input, [incoming], input.shifts, { updateRegistrations: [original.registration] });
    expect(reconciled.employees[0].fixedRestSlots).toEqual(original.fixedRestSlots);
    expect(reconciled.employees[0].fixedOffDays).toEqual([2]);
  });
  it("invalidates a candidate when an explicit setting changes and generation never enables a disabled slot", () => {
    const input = fixture(); input.assignments = [];
    const prior = generationScenarioBasis(input);
    input.employees[0] = withFixedRestSlots(input.employees[0], [{ enabled: false, weekday: 2 }, { enabled: false, weekday: 6 }]);
    expect(generationScenarioBasis(input)).not.toBe(prior);
    const prepared = prepareGeneration(input).input;
    expect(prepared.employees[0].fixedRestSlots).toEqual(input.employees[0].fixedRestSlots);
    expect(prepared.employees[0].offMode).toBe("VARIABLE");
    expect(prepared.employees[0].fixedOffDays).toEqual([]);
  });
});

describe("v3 Sunday closure and variable patterns", () => {
  it.each(["02", "2", "002", " 02 "])("closes Sundays for branch %s without creating a personal fixed day or holiday", code => {
    const input = fixture(code), before = structuredClone(input);
    input.demands = [{ id: "estimate", sector: "Sintético", date: "2026-12-06", start: 480, end: 720, minimum: 1, estimated: true },
      { id: "mandatory", sector: "Sintético", date: "2026-12-06", start: 480, end: 720, minimum: 1 }];
    const prepared = applyBranchRestCalendar(input);
    expect(prepared.policy.closedDates).toContain("2026-12-06");
    expect(prepared.policy.closedDates).toContain("2026-12-27");
    expect(prepared.policy.holidayDates).toEqual([]);
    expect(prepared.employees).toEqual(before.employees);
    expect(prepared.demands.map(item => item.id)).toEqual(["mandatory"]);
    expect(applyBranchRestCalendar(prepared)).toBe(prepared);
    expect(input.policy.closedDates).toEqual([]);
  });
  it("leaves other stores and legacy revisions untouched", () => {
    const other = fixture("06"), legacy = fixture("02"); legacy.restRulesVersion = 2;
    expect(applyBranchRestCalendar(other)).toBe(other); expect(applyBranchRestCalendar(legacy)).toBe(legacy);
  });
  it("requires variation, not compulsory alternation every week", () => {
    const input = applyBranchRestCalendar(fixture("02"));
    expect(variableRestIssues(input).map(issue => issue.code)).toEqual(["VARIABLE_REST_PATTERN_FIXED"]);
    input.assignments = input.assignments.map(item => item.date === "2026-12-09" ? { ...item, kind: "WORK", shiftId: input.shifts[0].id }
      : item.date === "2026-12-10" ? { employeeId: item.employeeId, date: item.date, kind: "OFF" } : item);
    expect(variableRestIssues(input)).toEqual([]);
  });
  it("excludes real absences, holidays, locks, partial weeks and consecutive requests", () => {
    const input = fixture(), person = input.employees[0];
    input.assignments[1] = { ...input.assignments[1], kind: "ABSENCE", shiftId: undefined };
    input.assignments[8].locked = true;
    input.policy.holidayDates = [addDays(input.startDate, 15)];
    expect(variableRestGroups(input, person)).toEqual([]);
    input.assignments = []; input.policy.holidayDates = []; person.activeUntil = addDays(input.startDate, 9);
    expect(variableRestGroups(input, person)).toEqual([]);
    delete person.activeUntil; person.offPattern = "CONSECUTIVE";
    expect(variableRestGroups(input, person)).toEqual([]);
    person.offPattern = "ANY"; input.generationMode = "HOURS_ONLY";
    expect(variableRestGroups(input, person)).toEqual([]);
  });
  it("accepts explicitly configured two rests and does not reinterpret a published snapshot", () => {
    const input = fixture();
    expect(validateEscala(input).issues.map(issue => issue.code)).toContain("VARIABLE_REST_PATTERN_FIXED");
    expect(validateEscala(input, { publishedSnapshot: true }).issues.map(issue => issue.code)).not.toContain("VARIABLE_REST_PATTERN_FIXED");
    input.employees[0] = withFixedRestSlots(input.employees[0], [{ enabled: true, weekday: 2 }, { enabled: true, weekday: 6 }]);
    expect(variableRestIssues(input)).toEqual([]);
  });
  it("independently rejects WORK and DUTY on an ordinary closed Sunday", () => {
    for (const kind of ["WORK", "DUTY"] as const) {
      const input = fixture("02");
      if (kind === "DUTY") { input.employees[0].scheduleMode = "UNTIMED"; input.employees[0].shiftIds = []; }
      input.assignments[0] = { employeeId: "synthetic", date: input.startDate, kind, ...(kind === "WORK" ? { shiftId: input.shifts[0].id } : {}) };
      expect(validateEscala(input).issues.some(issue => issue.code === "CLOSED_DATE")).toBe(true);
    }
  });
});
