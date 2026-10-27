import { describe, expect, it } from "vitest";
import { previewEscalaImport, previewEscalaRows } from "./import";

const options = { branchCode: "2", startDate: "2026-10-26", defaultWeeklyHours: 42 as const };
const header = [["0001", "-", "Empresa", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"]];
const person = (registration: string, zero = false) => [
  [registration, "-", "Pessoa Sintética", "Operador", zero ? "00:00" : "07:00", "-", zero ? "00:00" : "11:00", zero ? "00:00" : "13:00", "-", zero ? "00:00" : "16:20"],
  ["Sábado:", "07:00", "-", "11:00", "13:00", "-", "16:20", "07:00", "0026"],
];
const rows = () => [...header, ["02.01 , ICARAIMA, ADMINISTRATIVO"], ["Horário:", "0026", "-", "07:00 11:00 13:00 16:20"], ...person("001"), ...header, ...person("002", true), ["06.02 , BIG, LOJA"], ...person("003")];
const csv = (data: unknown[][]) => data.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");

describe("FPRE136 single report import", () => {
  it("filters branch, preserves page context and source hours without inventing admission, classification or history", () => {
    const preview = previewEscalaRows(rows(), options);
    expect(preview.issues).toEqual([]);
    expect(preview.report).toEqual({ format: "FPRE136", branchCode: "02", branchName: "ICARAIMA", sourceEmployees: 3, otherBranchesExcluded: 1, missingSchedule: 1 });
    expect(preview.totalRows).toBe(2);
    expect(preview.employees[0]).toMatchObject({ registration: "001", activeFrom: "", weeklyHours: 42, weeklyHoursMode: "BRANCH", planningEnabled: true, scheduleMode: "TIMED", historyKnown: false, history: [], sundayRestRule: "PROTECTIVE", maxConsecutiveSundays: 1,
      sourceSchedule: { report: "FPRE136", code: "0026", description: "07:00 11:00 13:00 16:20", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00 / 13:00-16:20" } });
    expect(preview.employees[1]).toMatchObject({ registration: "002", planningEnabled: true, scheduleMode: "UNTIMED", shiftIds: [], activeFrom: "", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE" });
    expect(preview.shifts).toHaveLength(1);
    expect(preview.shifts[0].segments).toEqual([{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }]);
    expect(JSON.stringify(preview)).not.toContain('"003"');
  });
  it("accepts Windows-1252 and quoted heterogeneous CSV only after report identification", async () => {
    const data = csv(rows());
    const preview = await previewEscalaImport(Buffer.from(data, "latin1"), "csv", options);
    expect(preview.employees[0].name).toBe("Pessoa Sintética");
    expect(preview.report?.sourceEmployees).toBe(3);
    await expect(previewEscalaImport(Buffer.from("Matricula;Nome\n1;Jos\xe9", "latin1"), "csv", options)).rejects.toThrow();
    await expect(previewEscalaImport(Buffer.from("a,b\n1,2,3"), "csv", options)).rejects.toThrow();
  });
  it("applies employee limits after filtering and requires the selected branch", () => {
    const data = [...header, ["06.02 , BIG, LOJA"], ...Array.from({ length: 300 }, (_, i) => person(String(i))).flat(), ["02.01 , ICARAIMA, ADMINISTRATIVO"], ["Horário:", "0026", "-", "07:00 11:00 13:00 16:20"], ...person("1")];
    expect(previewEscalaRows(data, options).employees).toHaveLength(1);
    expect(() => previewEscalaRows(data, { ...options, branchCode: "18" })).toThrow(/filial selecionada/);
    expect(() => previewEscalaRows(data, { ...options, branchCode: undefined })).toThrow(/Selecione a filial/);
    expect(() => previewEscalaRows(data, { ...options, branchCode: "06" })).toThrow(/250/);
  });
  it("reports duplicate registrations, invalid schedules and missing Saturday without silently importing them", () => {
    const data = rows(); data.splice(5, 0, ...person("001"));
    expect(previewEscalaRows(data, options).issues[0].message).toContain("duplicada");
    const invalid = rows(); invalid[5][4] = "24:00";
    expect(previewEscalaRows(invalid, options).issues).toHaveLength(1);
    const noSaturday = rows(); noSaturday.splice(6, 1);
    expect(previewEscalaRows(noSaturday, options).issues[0].message).toContain("sábado ausente");
  });
  it("imports a single paid period with a zero second period and preserves the original source", () => {
    const data = rows(); data[5][7] = "00:00"; data[5][9] = "00:00";
    const preview = previewEscalaRows(data, options);
    expect(preview.issues).toEqual([]);
    expect(preview.employees[0].sourceSchedule?.weekday).toBe("07:00-11:00 / 00:00-00:00");
    expect(preview.shifts[0].segments).toEqual([{ start: 420, end: 660, kind: "WORK" }]);
  });
});
