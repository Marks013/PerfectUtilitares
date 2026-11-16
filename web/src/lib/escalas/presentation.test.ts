import { describe, expect, it } from "vitest";
import { assignmentPresentation, escalaDateLabel, escalaDuration, escalaShiftCodes, buildEscalaSchedule } from "./presentation";
import { sortEmployees } from "./order";
import type { EscalaEmployee, EscalaInput } from "./types";

const person: EscalaEmployee = { id: "a", registration: "001", name: "Ana", sector: "Padaria", role: "Zelador", weeklyHours: 40, shiftIds: ["b"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] };
const date = "2026-11-01";
const codes = escalaShiftCodes({ shifts: [{ id: "a", name: "Original", segments: [] }, { id: "b", name: "Proposto", segments: [] }] });

describe("shared Escalas presentation", () => {
  it("orders by sector and employee name before role without changing allocation priority", () => {
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
  it("labels an imported all-zero clock as ENC, without implying a legal exemption", () => {
    const zero = { ...person, scheduleMode: "MISSING" as const, sourceSchedule: { report: "FPRE136" as const, code: "000", description: "Sem horário fixo", weekday: "00:00-00:00 / 00:00-00:00", saturday: "00:00-00:00", sunday: "00:00-00:00" } };
    const duty = { employeeId: "a", date, kind: "DUTY" as const };
    expect(assignmentPresentation(zero, date, duty, codes)).toEqual({ code: "ENC", description: expect.stringContaining("Sem horário fixo") });
    expect(assignmentPresentation(zero, date, { ...duty, kind: "OFF" }, codes).code).toBe("F");
    expect(assignmentPresentation(zero, date, undefined, codes).code).toBe("NP");
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
  it.each(["DAYS_AND_HOURS", "REST_ONLY", "HOURS_ONLY"] as const)("removes an inherited 8h24 proposal for an original 6h journey in %s without changing records", generationMode => {
    const source = input(); source.generationMode = generationMode;
    source.employees[0] = { ...source.employees[0], scheduleMode: "TIMED", planningEnabled: false,
      planningExclusionReason: "Jornada principal importada de até 6h, inclusive", sourceSchedule: { report: "FPRE136", code: "six", description: "Original", weekday: "07:00-10:00 / 11:00-14:00", saturday: "08:00-12:00 / 00:00-00:00" },
      manualShiftBaseIds: ["b"], manualShiftOverrides: [{ catalogCode: 1500, shiftId: "b", markings: ["09:36", "14:00", "16:00", "20:00"], effectiveFrom: source.startDate, effectiveUntil: source.endDate }],
      history: [{ employeeId: "a", date: "2026-11-01", kind: "WORK", shiftId: "b", locked: true }] };
    source.assignments[0].locked = true;
    source.assignments[1] = { employeeId: "a", date: "2026-11-03", kind: "ABSENCE", locked: true };
    const before = structuredClone(source), model = buildEscalaSchedule(source);
    expect(model.people.some(row => row.employee.id === "a")).toBe(false);
    expect(model.restPeople.some(row => row.employee.id === "a")).toBe(false);
    expect(model.hoursPeople.some(row => row.employee.id === "a")).toBe(false);
    expect(model.excluded.find(row => row.employee.id === "a")).toMatchObject({ code: "X", reason: before.employees[0].planningExclusionReason, employee: before.employees[0] });
    expect(source).toEqual(before);
    expect(model.hoursPeople.some(row => row.employee.id === "excluded")).toBe(true);
  });
  it("classifies a legacy enabled six-hour import only in the presentation and retains its base reference", () => {
    const source = input(); source.assignments = [];
    source.employees[0] = { ...source.employees[0], scheduleMode: "TIMED", planningEnabled: true,
      sourceSchedule: { report: "FPRE136", code: "six", description: "Original", weekday: "07:00-13:00 / 00:00-00:00", saturday: "08:00-12:00 / 00:00-00:00" } };
    const before = structuredClone(source), model = buildEscalaSchedule(source);
    expect(model.people.some(row => row.employee.id === "a")).toBe(false);
    expect(model.hoursPeople.some(row => row.employee.id === "a")).toBe(false);
    expect(model.excluded.find(row => row.employee.id === "a")).toMatchObject({ code: "X", reason: expect.stringContaining("até 6h, inclusive"), employee: { sourceSchedule: before.employees[0].sourceSchedule, shiftIds: ["b"] } });
    expect(source).toEqual(before);
  });
  it.each(["07:00-10:00 / 11:00-14:01", "08:00-12:00 / 13:00-17:00"])("preserves active original %s with a four-hour Saturday", weekday => {
    const source = input(); source.employees[0] = { ...source.employees[0], scheduleMode: "TIMED",
      sourceSchedule: { report: "FPRE136", code: "long", description: "Original", weekday, saturday: "08:00-12:00 / 00:00-00:00" } };
    const before = structuredClone(source), model = buildEscalaSchedule(source);
    expect(model.people.some(row => row.employee.id === "a")).toBe(true);
    expect(model.hoursPeople.find(row => row.employee.id === "a")?.proposedVariants).toHaveLength(2);
    expect(source).toEqual(before);
  });
  it("keeps an original zero-clock ENC active without exposing an inherited timed proposal", () => {
    const source = input(); source.employees[0] = { ...source.employees[0], scheduleMode: "UNTIMED",
      sourceSchedule: { report: "FPRE136", code: "zero", description: "Sem horário", weekday: "00:00-00:00 / 00:00-00:00", saturday: "00:00-00:00 / 00:00-00:00" } };
    const before = structuredClone(source), model = buildEscalaSchedule(source);
    expect(model.people.find(row => row.employee.id === "a")?.cells.every(cell => cell.code === "ENC")).toBe(true);
    expect(model.hoursPeople.find(row => row.employee.id === "a")?.proposedVariants).toEqual([]);
    expect(model.excluded.some(row => row.employee.id === "a")).toBe(false);
    expect(source).toEqual(before);
  });
});
