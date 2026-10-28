import { describe, expect, it } from "vitest";
import { assignmentPresentation, escalaDateLabel, escalaDuration, escalaShiftCodes } from "./presentation";
import { sortEmployees } from "./order";
import type { EscalaEmployee } from "./types";

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
    expect(assignmentPresentation(person, date, undefined, codes).code).toBe("P");
    expect(assignmentPresentation({ ...person, activeFrom: "2026-11-02" }, date, undefined, codes).code).toBe("FV");
    expect(assignmentPresentation({ ...person, activeUntil: "2026-10-31" }, date, undefined, codes).code).toBe("FV");
    expect(assignmentPresentation({ ...person, planningEnabled: false, planningExclusionReason: "Horário não preparado" }, date, undefined, codes)).toEqual({ code: "EX", description: "Não incluído: Horário não preparado" });
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "ABSENCE" }, codes).code).toBe("A");
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "OFF" }, codes).code).toBe("F");
    expect(assignmentPresentation(person, date, { employeeId: "a", date, kind: "WORK", shiftId: "missing" }, codes).code).toBe("P");
  });
  it("never invents hours or confirmed legal status for attendance without a schedule", () => {
    const duty = { employeeId: "a", date, kind: "DUTY" as const };
    expect(assignmentPresentation({ ...person, scheduleMode: "MISSING" }, date, duty, codes)).toEqual({ code: "SF", description: "Presença planejada sem horário informado; horas e cobertura horária não apuradas" });
    expect(assignmentPresentation({ ...person, scheduleMode: "UNTIMED" }, date, duty, codes).description).toContain("confirmado");
  });
  it("uses civil date labels and keeps next-day offsets explicit", () => {
    expect(escalaDateLabel(date)).toBe("01/11 Dom");
    expect(escalaDuration(1500)).toBe("25:00");
  });
});
