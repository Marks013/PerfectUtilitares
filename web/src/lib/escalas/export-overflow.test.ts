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

  it("paginates oversized coverage rows without drawing below the page or losing any role", async () => {
    const workspace = crowded(), drawn: { text: string; y: number }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      drawn.push({ text, y: options?.y ?? 0 });
      return original.call(this, text, options);
    });
    try {
      const bytes = await exportEscalaPdf(workspace, "hours");
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
      expect(drawn.filter(item => item.y < 16)).toEqual([]);
      expect(drawn.some(item => item.text.includes("Desfalques de cobertura (continuação)"))).toBe(true);
      const text = drawn.map(item => item.text).join(" ");
      for (let index = 0; index < 32; index++) expect(text).toContain(`Cargo ${String(index).padStart(2, "0")}`);
    } finally { spy.mockRestore(); }
  });

  it("splits long Excel lists into visible continuation rows with their date and sector", async () => {
    const workspace = crowded(), bytes = exportEscalaXlsx(workspace, "hours");
    const rows = await readSheet(Buffer.from(bytes), "Desfalques");
    const coverage = rows.filter(row => row[0] === "2026-11-01");
    expect(coverage.length).toBeGreaterThan(1);
    expect(coverage.every(row => row[1] === "Setor" && row[2])).toBe(true);
    expect(coverage[0].slice(3, 5)).toEqual([0, 32]);
    expect(coverage.slice(1).every(row => row[3] == null && row[4] == null && row[5] == null)).toBe(true);
    expect(coverage.slice(1).every(row => String(row[7]).includes("continuação"))).toBe(true);
    const text = coverage.map(row => row[6]).join(" ");
    for (const person of workspace.input.employees) expect(text).toContain(person.role);
    const files = unzipSync(bytes);
    for (const [path, value] of Object.entries(files)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      for (const match of strFromU8(value).matchAll(/<row[^>]* ht="([\d.]+)"/g)) expect(Number(match[1])).toBeLessThanOrEqual(409);
    }
  });
});
