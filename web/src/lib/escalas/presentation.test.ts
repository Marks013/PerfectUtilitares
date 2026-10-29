import { describe, expect, it } from "vitest";
import { assignmentPresentation, escalaDateLabel, escalaDuration, escalaShiftCodes, buildEscalaSchedule } from "./presentation";
import { sortEmployees } from "./order";
import type { EscalaEmployee, EscalaInput } from "./types";

const person: EscalaEmployee = { id: "a", registration: "001", name: "Ana", sector: "Padaria", role: "Zelador", weeklyHours: 40, shiftIds: ["b"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] };
const date = "2026-11-01";
const codes = escalaShiftCodes({ shifts: [{ id: "a", name: "Original", segments: [] }, { id: "b", name: "Proposto", segments: [] }] });

describe("shared Escalas presentation", () => {
  it("orders by sector then employee name, never by job title", () => {
    const people = [person, { ...person, id: "b", name: "Zélia", role: "Auxiliar" }, { ...person, id: "c", name: "Bia", sector: "Açougue" }];
    expect(sortEmployees(people).map((employee) => employee.id)).toEqual(["c", "a", "b"]);
    expect(people.map((employee) => employee.id)).toEqual(["a", "b", "c"]);
  });
  it("keeps the same shift code when only one shift is used", () => {
    expect(codes.get("b")).toBe("T02");
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "WORK", shiftId: "b" }, codes).code).toBe("T02");
  });
  it("distinguishes missing information, absence, exclusion and employment boundaries", () => {
    expect(assignmentPresentation(person, date, undefined, codes).code).toBe("NP");
    expect(assignmentPresentation({ ...person, activeFrom: "2026-11-02" }, date, undefined, codes).code).toBe("FV");
    expect(assignmentPresentation({ ...person, activeUntil: "2026-10-31" }, date, undefined, codes).code).toBe("FV");
    expect(assignmentPresentation({ ...person, planningEnabled: false, planningExclusionReason: "Horário não preparado" }, date, undefined, codes)).toEqual({ code: "X", description: "Horário não preparado" });
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "ABSENCE" }, codes).code).toBe("AF");
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "OFF" }, codes).code).toBe("F");
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "WORK", shiftId: "missing" }, codes).code).toBe("NP");
  });
  it("never invents hours or confirmed legal status for attendance without a schedule", () => {
    const duty = { employeeId: "a", date, kind: "DUTY" as const };
    expect(assignmentPresentation({ ...person, scheduleMode: "MISSING" }, date, duty, codes)).toEqual({ code: "NP", description: "Horário não processado: presença diária planejada sem horário informado; defina um horário para apurar horas e cobertura" });
    expect(assignmentPresentation({ ...person, scheduleMode: "UNTIMED" }, date, duty, codes).code).toBe("ENC");
  });
  it("uses civil date labels and keeps next-day offsets explicit", () => {
    expect(escalaDateLabel(date)).toBe("01/11 Dom");
    expect(escalaDuration(1500)).toBe("25:00");
  });
});

describe("exact schedule and separate exclusions", () => {
  function input(): EscalaInput {
    return { schemaVersion: 1, branchCode: "1", branchName: "Loja", startDate: "2026-11-02", endDate: "2026-11-03", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: {} as EscalaInput["policy"], employees: [person, { ...person, id: "excluded", registration: "002", name: "Excluída", planningEnabled: false, planningExclusionReason: "Decisão manual de não incluir" }],
      shifts: [{ id: "b", name: "Proposto", segments: [{ start: 576, end: 840, kind: "WORK" }, { start: 840, end: 960, kind: "BREAK" }, { start: 960, end: 1200, kind: "WORK" }] },
        { id: "c", name: "Outra proposta", segments: [{ start: 580, end: 810, kind: "WORK" }, { start: 810, end: 930, kind: "BREAK" }, { start: 930, end: 1204, kind: "WORK" }] }],
      demands: [], assignments: [{ employeeId: "a", date: "2026-11-02", kind: "WORK", shiftId: "b" }, { employeeId: "a", date: "2026-11-03", kind: "WORK", shiftId: "c" }, { employeeId: "excluded", date: "2026-11-02", kind: "WORK", shiftId: "b" }] };
  }
  it("retains minute-exact variants, their dates and original inputs without adding shifts", () => {
    const source = input(), before = structuredClone(source), model = buildEscalaSchedule(source);
    expect(model.people).toHaveLength(1); expect(model.excluded).toHaveLength(1);
    expect(model.people[0].proposedVariants.map((variant) => [variant.schedule, variant.daily, variant.dates])).toEqual([
      ["09:36-14:00 / 16:00-20:00", "08:24", ["2026-11-02"]], ["09:40-13:30 / 15:30-20:04", "08:24", ["2026-11-03"]],
    ]);
    expect(model.people[0].proposedSchedule).toContain("Varia no mês");
    expect(model.excluded[0]).toEqual(expect.objectContaining({ code: "X", reason: "Decisão manual de não incluir", guidance: expect.stringContaining("cadastro") }));
    expect(source).toEqual(before);
  });
  it("does not infer exemption from a job title, a missing clock, or a stale timed assignment", () => {
    const source = input(); source.employees[0] = { ...person, role: "Gerente", scheduleMode: "MISSING" };
    const model = buildEscalaSchedule(source);
    expect(model.people[0].cells.every((cell) => cell.code === "NP" && !cell.shiftId)).toBe(true);
    expect(model.people[0].proposedVariants).toEqual([]);
    source.employees[0].scheduleMode = "UNTIMED";
    expect(buildEscalaSchedule(source).people[0].cells.every((cell) => cell.code === "ENC")).toBe(true);
  });
});
