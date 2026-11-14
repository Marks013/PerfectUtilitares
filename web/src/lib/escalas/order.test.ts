import { describe, expect, it } from "vitest";
import { sortEmployees, sortHoursEmployees, sortScheduleEntries } from "./order";
import type { EscalaEmployee, EscalaInput } from "./types";

const employee = (id: string, name: string, sector = "Padaria", role = "Auxiliar") => ({ id, name, sector, role, registration: id });

describe("operational display order", () => {
  it("orders accented sector names naturally without mutating the source", () => {
    const source = [employee("3", "C", "Zeladoria"), employee("2", "B", "Açougue"), employee("1", "A", "Água")];
    expect(sortEmployees(source).map(item => item.sector)).toEqual(["Açougue", "Água", "Zeladoria"]);
    expect(source.map(item => item.id)).toEqual(["3", "2", "1"]);
  });
  it("uses assigned monthly clocks rather than imported references or unused allowed shifts", () => {
    const people = [employee("a", "Ana"), employee("b", "Bia"), { ...employee("c", "Caio"), scheduleMode: "MISSING" as const }];
    const source = { employees: people as EscalaEmployee[], visibleMonth: "2026-11", startDate: "2026-10-26", endDate: "2026-12-06",
      shifts: [
        { id: "late", segments: [{ start: 720, end: 1224, kind: "WORK" }] },
        { id: "early", segments: [{ start: 420, end: 924, kind: "WORK" }] },
        { id: "unused", segments: [{ start: 300, end: 804, kind: "WORK" }] },
      ], assignments: [
        { employeeId: "a", date: "2026-11-02", kind: "WORK", shiftId: "late" },
        { employeeId: "b", date: "2026-11-02", kind: "WORK", shiftId: "early" },
        { employeeId: "a", date: "2026-10-31", kind: "WORK", shiftId: "unused" },
        { employeeId: "c", date: "2026-11-02", kind: "WORK", shiftId: "unused" },
      ] } as EscalaInput;
    const before = structuredClone(source);
    expect(sortHoursEmployees(source).map(item => item.id)).toEqual(["b", "a", "c"]);
    expect(source).toEqual(before);
  });
  it("groups roles within sectors before complete clocks and names, not shift identifiers", () => {
    const rows = [
      { employee: employee("1", "Ana"), schedule: "12:30-16:20 / 18:20-22:54" },
      { employee: employee("2", "Zélia"), schedule: "07:30-11:20 / 13:20-17:54" },
      { employee: employee("3", "Bia", "Padaria", "Padeiro"), schedule: "07:30-11:20 / 13:20-17:54" },
      { employee: employee("4", "Caio"), schedule: "07:30-11:30 / 13:30-17:54" },
      { employee: employee("5", "Diogo", "Açougue"), schedule: "15:30-19:20 / 21:20-25:54" },
      { employee: employee("6", "Eva"), schedule: "ENC — Sem horário fixo" },
    ];
    expect(sortScheduleEntries(rows).map(item => item.employee.id)).toEqual(["5", "2", "4", "1", "6", "3"]);
    expect(rows[0].employee.id).toBe("1");
  });
  it("preserves the original name-first contract for non-schedule consumers", () => {
    const source = [
      employee("z", "Zélia", "Padaria", "Auxiliar"),
      { ...employee("b", "Ana", "Padaria", "Padeiro"), registration: "10" },
      { ...employee("c", "Ana", "Padaria", "Padeiro"), registration: "2" },
      { ...employee("a", "Ana", "Padaria", "Padeiro"), registration: "2" },
      employee("d", "Ana", "Padaria", "Auxiliar"),
    ];
    expect(sortEmployees(source).map(person => person.id)).toEqual(["d", "a", "c", "b", "z"]);
    expect(source.map(person => person.id)).toEqual(["z", "b", "c", "a", "d"]);
  });
  it("uses role collation, full clock geometry and stable identity ties without inventing ENC clocks", () => {
    const rows = [
      { employee: employee("late-role", "Ana", "Padaria", "Zelador"), schedule: "05:00-09:00 / 10:00-14:00" },
      { employee: employee("late-clock", "Ana", "Padaria", "Áuxiliar"), schedule: "09:00-13:00 / 14:00-18:00" },
      { employee: employee("geometry", "Zélia", "Padaria", "Áuxiliar"), schedule: "07:00-10:30 / 12:30-16:00" },
      { employee: employee("accent", "Álvaro", "Padaria", "Áuxiliar"), schedule: "07:00-11:00 / 12:00-16:00" },
      { employee: { ...employee("b", "Bia", "Padaria", "Áuxiliar"), registration: "2" }, schedule: "07:00-11:00 / 12:00-16:00" },
      { employee: { ...employee("a", "Bia", "Padaria", "Áuxiliar"), registration: "2" }, schedule: "07:00-11:00 / 12:00-16:00" },
      { employee: employee("manual", "Zélia", "Padaria", "Áuxiliar"), schedule: "Referência manual: 06:00-10:00 / 11:00-15:00, vigente 02/11/2026" },
      { employee: employee("enc", "Aline", "Padaria", "Áuxiliar"), schedule: "ENC — Sem horário fixo" },
      { employee: employee("first-role", "Zélia", "Padaria", "Ajudante"), schedule: "12:00-16:00 / 17:00-21:00" },
    ];
    const before = structuredClone(rows);
    expect(sortScheduleEntries(rows).map(row => row.employee.id)).toEqual([
      "first-role", "manual", "geometry", "accent", "a", "b", "late-clock", "enc", "late-role",
    ]);
    expect(rows).toEqual(before);
  });
});
