import { describe, expect, it } from "vitest";
import { newInput, newEmployee } from "../../components/escalas/workspace-model";
import { selectVerifiedRoster, coverageQuality } from "./roster-quality";
import { validateEscala } from "./validation";
import type { EscalaAssignment, EscalaInput } from "./types";
import { addDays } from "./dates";
import { weekendBalance } from "./weekend-balance";

function fixture(): EscalaInput {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.simulation = true; input.restRulesVersion = 1;
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42, "day"), id, name: id, registration: id, sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }));
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, day) => {
    const off = (person.id === "a" ? [1, 6] : [5, 6]).includes(day);
    return { employeeId: person.id, date: `2026-11-0${day + 2}`, kind: off ? "OFF" as const : "WORK" as const, ...(!off ? { shiftId: "day" } : {}) };
  }));
  return input;
}
function swap(input: EscalaInput): EscalaInput {
  return { ...input, assignments: input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-03" ? { ...record, kind: "WORK" as const, shiftId: "day" }
    : record.employeeId === "a" && record.date === "2026-11-04" ? { employeeId: record.employeeId, date: record.date, kind: "OFF" as const } : record) };
}
describe("independent incumbent quality acceptance", () => {
  it("does not empty a staffed sector day merely because no hourly minimum was entered", () => {
    const input = fixture(); input.employees = input.employees.slice(0, 1);
    input.assignments = input.assignments.filter(record => record.employeeId === "a");
    expect(validateEscala(input).valid).toBe(true);
    expect(coverageQuality(input).present.size).toBe(5);
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
  it("preserves a valid draft when monthly gains spend another civil day's coverage", () => {
    const input = fixture();
    input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 3, estimated: true },
      { id: "wed", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 2, estimated: true }];
    expect(validateEscala(input).valid).toBe(true);
    const result = selectVerifiedRoster(input, swap(input));
    expect(result.input).toBe(input); expect(result.retainedReference).toBe(true);
  });
  it("accepts a real gain with no sacrificed day and leaves both inputs untouched", () => {
    const input = fixture(); input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 2, estimated: true }];
    const proposal = swap(input), original = structuredClone(input);
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
    expect(input).toEqual(original);
  });
  it("uses summed and deduplicated function shortages, not the largest missing role", () => {
    const input = fixture(); input.assignments = []; input.employees = [];
    input.demands = [
      { id: "a", date: "2026-11-03", sector: "Loja", role: "Caixa", start: 480, end: 540, minimum: 2, estimated: true },
      { id: "b", date: "2026-11-03", sector: "Loja", role: "Caixa", start: 480, end: 540, minimum: 1, estimated: true },
      { id: "c", date: "2026-11-03", sector: "Loja", role: "Fiscal", start: 480, end: 540, minimum: 1, estimated: true },
    ];
    expect(coverageQuality(input).daily.get("Loja" + "\0" + "2026-11-03")).toBe(180);
  });
  it("retains the last responsible leader on a declared peak even without hourly demand", () => {
    const input = fixture(); input.employees[0].role = "Encarregado";
    input.movementPriorities = [{ startDate: "2026-11-04", endDate: "2026-11-04", sector: "Loja", level: "HIGH" }];
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
  it("does not substitute a new unverified solution for an invalid comparison roster", () => {
    const input = fixture(); input.assignments = [];
    const proposal = fixture();
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
  });
  it("accepts a verified v2 replacement instead of retaining an old Saturday OFF reference", () => {
    const reference = fixture();
    expect(validateEscala(reference).valid).toBe(true);
    reference.restRulesVersion = 2;
    const original = structuredClone(reference);
    const validation = validateEscala(reference);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some(issue => issue.code === "SATURDAY_REST_FORBIDDEN")).toBe(true);
    const proposal: EscalaInput = { ...reference, assignments: reference.assignments.map((record): EscalaAssignment => {
      if (record.employeeId !== "b") return record;
      if (record.date === "2026-11-07") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.date === "2026-11-04") return { employeeId: record.employeeId, date: record.date, kind: "OFF" };
      return record;
    }) };
    expect(validateEscala(proposal).valid).toBe(true);
    expect(selectVerifiedRoster(reference, proposal)).toEqual({ input: proposal, retainedReference: false });
    expect(reference).toEqual(original);
  });
  it("compares Sunday rates using real availability and only known prior Sundays", () => {
    const input = fixture();
    input.endDate = "2026-11-15";
    input.assignments = input.assignments.concat(input.assignments.map(record => ({ ...record, date: addDays(record.date, 7) })));
    input.assignments = input.assignments.map((record): EscalaAssignment => {
      if (record.date === "2026-11-08") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.date === "2026-11-04" || record.employeeId === "b" && record.date === "2026-11-09")
        return { employeeId: record.employeeId, date: record.date, kind: "OFF" };
      if (record.employeeId === "b" && record.date === "2026-11-14") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.employeeId === "b" && record.date === "2026-11-15") return { employeeId: record.employeeId, date: record.date, kind: "ABSENCE" };
      return record;
    });
    expect(validateEscala(input).valid).toBe(true);
    // Both worked one Sunday: a had two available Sundays, b only one due to absence.
    expect(input.employees.map(person => input.assignments.filter(record => record.employeeId === person.id
      && record.date === "2026-11-08" && record.kind === "WORK").length)).toEqual([1, 1]);
    expect([...weekendBalance(input, 6).values()]).toEqual([5000]);
    // One known prior OFF makes b's rate 1/2 too; unknown history never adds availability.
    input.employees[1].history = [{ employeeId: "b", date: "2026-10-25", kind: "OFF" }];
    expect([...weekendBalance(input, 6).values()]).toEqual([0]);
  });
  it("keeps valid reference assignments when the processor changes a protected absence", () => {
    const input = fixture(); const day = input.assignments.find(record => record.employeeId === "a" && record.date === "2026-11-03");
    if (!day) throw new Error("Missing fixture day"); day.kind = "ABSENCE";
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
});
