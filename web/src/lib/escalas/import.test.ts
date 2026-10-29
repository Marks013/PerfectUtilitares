import { describe, expect, it } from "vitest";
import { ESCALA_IMPORT_TEMPLATE, previewEscalaImport, previewEscalaRows } from "./import";
import { exportEscalaXlsx } from "./export";
import type { EscalaInput } from "./types";

const options = { startDate: "2026-10-26", defaultWeeklyHours: 42 as const };
const header = ["Matricula", "Nome", "Setor", "Cargo", "CargaSemanal", "Horarios", "Admissao"];
const row = () => ["0001", "Ana Silva", "Reposição", "Repositor", "42", "08:00-12:00 / 13:00-17:24", "2020-01-01"];

describe("Escalas import preview", () => {
  it("preserves registration text, requires organization, separates meal from work and keeps history unknown", async () => {
    const preview = await previewEscalaImport(Buffer.from(`\uFEFF${header.join(";")}\n${row().join(";")}`), "csv", options);
    expect(preview.issues).toEqual([]);
    expect(preview.employees[0]).toMatchObject({ registration: "0001", name: "Ana Silva", weeklyHours: 42, activeFrom: "2020-01-01", historyKnown: false });
    expect(preview.shifts[0].segments).toEqual([{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }]);
    expect(ESCALA_IMPORT_TEMPLATE).toContain("Admissao");
  });
  it("never guesses admission from the scheduling period or hides missing sector", () => {
    const missing = row(); missing[6] = "";
    const sector = row(); sector[2] = "";
    const preview = previewEscalaRows([header, missing, sector], options);
    expect(preview.employees).toEqual([]);
    expect(preview.issues).toHaveLength(2);
    expect(preview.issues[0].message).toContain("data real de admissão");
    expect(preview.issues[1].message).toContain("setor");
  });
  it("does not merge homonyms and rejects duplicate registrations", () => {
    const second = row(); second[0] = "0002";
    const preview = previewEscalaRows([header, row(), second, row()], options);
    expect(preview.employees).toHaveLength(2);
    expect(preview.employees[0].id).not.toBe(preview.employees[1].id);
    expect(preview.shifts).toHaveLength(1);
    expect(preview.issues[0].message).toContain("duplicada");
  });
  it.each(["39", "44,5", "0", "texto"])("rejects unsupported weekly hours %s", (hours) => {
    const value = row(); value[4] = hours;
    expect(previewEscalaRows([header, value], options).issues[0].message).toContain("40, 42 ou 44");
  });
  it.each(["24:00-25:00", "08:60-12:00", "12:00-08:00", "08:00-12:00 / 11:00-17:00", "sem horário"])("rejects invalid shift %s", (schedule) => {
    const value = row(); value[5] = schedule;
    expect(previewEscalaRows([header, value], options).issues).toHaveLength(1);
  });
  it("uses the configured default only for missing hours, handles XLSX dates and skips blank lines", () => {
    const value: unknown[] = row(); value[4] = ""; value[6] = new Date("2020-01-01T00:00:00Z");
    const preview = previewEscalaRows([header, value, []], { ...options, defaultWeeklyHours: 40 });
    expect(preview.employees[0].weeklyHours).toBe(40);
    expect(preview.issues).toEqual([]);
  });
  it("rejects unsupported layouts, excessive rows and ZIP impostors", async () => {
    expect(() => previewEscalaRows([["FPRE131"], row()], options)).toThrow(/modelo/);
    expect(() => previewEscalaRows([header, ...Array.from({ length: 251 }, row)], options)).toThrow(/250/);
    await expect(previewEscalaImport(Buffer.from("not-xlsx"), "xlsx", options)).rejects.toThrow(/segurança/);
    await expect(previewEscalaImport(Buffer.from([0xff]), "csv", options)).rejects.toThrow();
  });
  it("accepts a real XLSX file produced from the same exact cell values", async () => {
    // The export is a valid archive; its operational layout must still be rejected, not guessed as an import.
    const payload: EscalaInput = { schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
      policy: { source: "", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false,
        minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [], shifts: [], demands: [], assignments: [] };
    const bytes = exportEscalaXlsx({ id: "w", revision: 1, status: "DRAFT", input: payload, canEdit: true, canPublish: true, validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null }, updatedAt: "2026-10-26" });
    await expect(previewEscalaImport(Buffer.from(bytes), "xlsx", options)).rejects.toThrow(/modelo/);
  });
});
