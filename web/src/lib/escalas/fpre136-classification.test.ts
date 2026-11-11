import { describe, expect, it } from "vitest";
import { previewEscalaRows } from "./import";

const options = { branchCode: "02", startDate: "2026-11-02", defaultWeeklyHours: 42 as const };
function report(weekday: string[], saturday = weekday) {
  return [["0001", "-", "Empresa sintética", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"],
    ["02.01 , ICARAIMA, CAIXA"], ["Horário:", "001", "-", "Referência sintética"],
    ["001", "-", "Pessoa sintética", "ENC. CAIXA", weekday[0], "-", weekday[1], weekday[2], "-", weekday[3]],
    ["Sábado:", saturday[0], "-", saturday[1], saturday[2], "-", saturday[3]]];
}

describe("FPRE136 classification contract", () => {
  it("classifies confirmed four-zero references as UNTIMED without a clock", () => {
    const result = previewEscalaRows(report(["00:00", "00:00", "00:00", "00:00"]), options);
    expect(result.employees[0]).toMatchObject({ scheduleMode: "UNTIMED", shiftIds: [] });
    expect(result.shifts).toEqual([]);
    expect(result.issues).toEqual([]);
  });
  it("preserves divergent Saturday data and adds a contextual nonblocking warning", () => {
    const result = previewEscalaRows(report(["00:00", "00:00", "00:00", "00:00"], ["08:00", "12:00", "00:00", "00:00"]), options);
    expect(result.employees[0]).toMatchObject({ scheduleMode: "UNTIMED", sourceSchedule: { saturday: "08:00-12:00 / 00:00-00:00" } });
    expect(result.issues[0].message).toContain("sábado");
    expect(result.shifts).toEqual([]);
  });
  it("keeps an incomplete reference as MISSING instead of dropping the person", () => {
    const result = previewEscalaRows(report(["07:00", "00:00", "13:00", "17:00"]), options);
    expect(result.employees[0]).toMatchObject({ scheduleMode: "MISSING", shiftIds: [] });
    expect(result.issues[0].message).toContain("incompleta");
  });
  it("retains a valid single paid period", () => {
    const result = previewEscalaRows(report(["07:00", "11:00", "00:00", "00:00"]), options);
    expect(result.employees[0].scheduleMode).toBe("TIMED");
    expect(result.shifts[0].segments).toEqual([{ start: 420, end: 660, kind: "WORK" }]);
  });
});
