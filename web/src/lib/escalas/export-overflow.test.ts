import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { dateRange } from "./dates";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

function crowded(): EscalaWorkspace {
  const input = newInput("08", "Teste de continuação", "2026-11", 42);
  input.simulation = true;
  input.policy.compensationAuthorized = true;
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = Array.from({ length: 32 }, (_, index) => ({ ...newEmployee(42, "day"), id: `p${index}`, registration: String(index + 1), name: `Pessoa ${index}`, role: `Cargo ${String(index).padStart(2, "0")} `.padEnd(80, "W"), sector: "Setor", scheduleMode: "TIMED" as const, activeFrom: "" }));
  input.assignments = input.employees.flatMap(person => dateRange(input.startDate, input.endDate).map(date => {
    const working = ![0, 6].includes(new Date(date + "T12:00:00Z").getUTCDay());
    return { employeeId: person.id, date, ...(working ? { kind: "WORK" as const, shiftId: "day" } : { kind: "OFF" as const }) };
  }));
  input.demands = input.employees.map((person, index) => ({ id: `d${index}`, date: "2026-11-01", sector: person.sector, role: person.role, start: 480, end: 720, minimum: 1, estimated: true }));
  expect(escalaInputSchema.safeParse(input).success).toBe(true);
  const validation = validateEscala(input);
  expect(validation.valid).toBe(true);
  expect(validation.issues.filter(issue => issue.severity === "ERROR")).toEqual([]);
  return { id: "overflow", revision: 1, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-30", input, validation };
}

describe("large but valid operational reports", () => {
  it("keeps each hourly sector heading beside its first employee on A4", async () => {
    const workspace = crowded();
    workspace.input.demands = [];
    workspace.input.employees.forEach((person, index) => { person.sector = `Setor ${String(index).padStart(2, "0")}`; });
    const drawn: { text: string; page: PDFPage }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      drawn.push({ text, page: this });
      return original.call(this, text, options);
    });
    try {
      await exportEscalaPdf(workspace, "hours");
      for (const person of workspace.input.employees) {
        const heading = drawn.find(item => item.text === person.sector);
        const employee = drawn.find(item => item.text === person.registration + " - " + person.name);
        expect(heading, person.sector).toBeDefined();
        expect(employee, person.name).toBeDefined();
        expect(heading?.page, person.sector).toBe(employee?.page);
      }
    } finally { spy.mockRestore(); }
  });

  it("keeps 6,000 monthly demands compact without dropping sectors or mandatory minima", async () => {
    const workspace = crowded();
    const days = dateRange("2026-11-01", "2026-11-30");
    const requiredSectors = Array.from({ length: 8 }, (_, index) => "Obrigatório " + index);
    workspace.input.demands = days.flatMap(date => [
      ...workspace.input.employees.flatMap(person => Array.from({ length: 6 }, (_, index) => ({
        id: `estimate-${date}-${person.id}-${index}`, date, sector: person.sector, role: person.role,
        start: 720 + index * 10, end: 725 + index * 10, minimum: 1, estimated: true,
      }))),
      ...requiredSectors.map((sector, index) => ({ id: `minimum-${date}-${index}`, date, sector,
        start: 1050, end: 1080, minimum: index + 1, estimated: false })),
    ]);
    expect(workspace.input.demands).toHaveLength(6000);
    expect(escalaInputSchema.safeParse(workspace.input).success).toBe(true);
    const drawn: { text: string; y: number; page: PDFPage }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      drawn.push({ text, y: options?.y ?? 0, page: this });
      return original.call(this, text, options);
    });
    try {
      const bytes = await exportEscalaPdf(workspace, "hours");
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
      expect(drawn.filter(item => item.y < 16)).toEqual([]);
      const report = new Set(drawn.filter(item => item.text.includes("Desfalques de cobertura")).map(item => item.page));
      expect(report.size).toBeGreaterThanOrEqual(1);
      expect(report.size).toBeLessThanOrEqual(2);
      const reportText = drawn.filter(item => report.has(item.page));
      for (const sector of requiredSectors) expect(reportText.filter(item => item.text === sector)).toHaveLength(1);
      expect(reportText.map(item => item.text).join(" ")).not.toMatch(/Cargo \d\d/);
    } finally { spy.mockRestore(); }
    const bytes = exportEscalaXlsx(workspace, "hours");
    const rows = await readSheet(Buffer.from(bytes), "Desfalques");
    expect(rows.slice(4).map(row => row[0])).toEqual([...requiredSectors, "Setor"]);
    expect(rows.slice(4).every(row => row[1] === "01/11–30/11")).toBe(true);
    expect(rows[11][4]).toContain("Até 8 pessoa(s)");
    expect(rows[11][5]).toContain("Mínimo informado não atendido em 30 dia(s)");
    expect(rows[12][3]?.toString().split("\n")).toHaveLength(3);
    expect(rows[12][4]).toContain("Até 32 pessoa(s)");
    const files = unzipSync(bytes);
    for (const [path, value] of Object.entries(files)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      for (const match of strFromU8(value).matchAll(/<row[^>]* ht="([\d.]+)"/g)) expect(Number(match[1])).toBeLessThanOrEqual(409);
    }
  });
});
