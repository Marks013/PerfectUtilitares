import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { dateRange } from "./dates";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { coverageBasis } from "./automatic-coverage";
import { analyzeCoverage } from "./coverage-analysis";
import { exportedDateISO } from "./export-test-utils";
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
  it("keeps grouped table headings with data near the bottom of A4 pages", async () => {
    const workspace = crowded();
    const drawn: { text: string; y: number; page: PDFPage }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      drawn.push({ text, y: options?.y ?? 0, page: this });
      return original.call(this, text, options);
    });
    try {
      for (const count of [7, 8, 9, 10, 11]) {
        drawn.length = 0;
        const employees = workspace.input.employees.slice(0, count);
        const ids = new Set(employees.map(person => person.id));
        const input = { ...workspace.input, employees, assignments: workspace.input.assignments.filter(day => ids.has(day.employeeId)) };
        input.coverageBasis = coverageBasis(input);
        const before = structuredClone(input);
        await exportEscalaPdf({ ...workspace, input }, "both");
        const hasDataOn = (heading: string, matches: (text: string) => boolean) => {
          const headers = drawn.filter(item => item.text === heading);
          expect(headers.length).toBeGreaterThan(0);
          expect(headers.every(header => drawn.some(item => item.page === header.page && item.y < header.y && item.y >= 45 && matches(item.text))), JSON.stringify(headers.map(header => ({ heading, y: header.y, values: drawn.filter(item => item.page === header.page && item.y < header.y).map(item => item.text).filter(text => /^(Estimada|32|Referência|Origem|\\d\\d:\\d\\d)/.test(text)).slice(0,12) })))).toBe(true);
        };
        hasDataOn("Horário proposto", text => text.includes("08:00-12:00 /"));
        hasDataOn("Setor / referência", text => text === "Estimada");
        hasDataOn("Setor / referência", text => text === "32");
        hasDataOn("Setor / referência", text => text === "08:00-12:00");
        expect(drawn.filter(item => item.y < 16)).toEqual([]);
        expect(input).toEqual(before);
      }
    } finally { spy.mockRestore(); }
  });

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
    // Known TIMED cohorts make the mandatory shortage numeric; absent cohorts are intentionally unknown.
    const mandatoryPeople = requiredSectors.map((sector, index) => ({ ...newEmployee(42, "day"), id: `required-${index}`,
      registration: `R${index}`, name: `Pessoa de referência ${index}`, role: "Atendente", sector, scheduleMode: "TIMED" as const, activeFrom: "" }));
    workspace.input.employees.push(...mandatoryPeople);
    workspace.input.assignments.push(...mandatoryPeople.flatMap(person => dateRange(workspace.input.startDate, workspace.input.endDate)
      .map(date => ({ employeeId: person.id, date, kind: "OFF" as const }))));
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    expect(workspace.input.demands).toHaveLength(6000);
    expect(escalaInputSchema.safeParse(workspace.input).success).toBe(true);
    const before = structuredClone(workspace);
    const central = analyzeCoverage(workspace.input, workspace.input, { referenceOrigin: "PERSISTED", details: true });
    const drawn: { text: string; y: number; page: PDFPage }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      drawn.push({ text, y: options?.y ?? 0, page: this });
      return original.call(this, text, options);
    });
    try {
      const bytes = await exportEscalaPdf(workspace, "hours", { separateSectors: false });
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
    expect(rows[3]).toHaveLength(12);
    expect(rows.slice(4).every(row => row.length === 12 && row[8] === 30)).toBe(true);
    for (const [index, sector] of requiredSectors.entries()) {
      const row = rows[index + 4], analysis = central.sectors.find(item => item.sector === sector)?.confirmed;
      if (!analysis) throw new Error(`Mandatory analysis missing for ${sector}`);
      expect(row[1]).toBe("Confirmada"); expect(row[2]).toBe(0); expect(row[3]).toBe(index + 1); expect(row[4]).toBe(index + 1);
      expect(exportedDateISO(row[5])).toBe("2026-11-01"); expect(row[6]).toBe("17:30-18:00");
      expect(analysis.requiredPersonMinutes).toBe(900 * (index + 1));
      expect(analysis.deficitPersonMinutes).toBe(900 * (index + 1));
    }
    expect(rows[12][1]).toBe("Estimada"); expect(rows[12][2]).toBe(0); expect(rows[12][3]).toBe(32); expect(rows[12][4]).toBe(32);
    expect(exportedDateISO(rows[12][5])).toBe("2026-11-01"); expect(rows[12][6]).toBe("12:00-12:05");
    expect(central.sectors.find(item => item.sector === "Setor")?.estimated?.deficitPersonMinutes).toBe(28800);
    const files = unzipSync(bytes);
    const summaryId = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet name="([^"]+)" sheetId="(\d+)"/g)].find(match => match[1] === "Desfalques")?.[2];
    if (!summaryId) throw new Error("Shortage worksheet missing");
    const summaryXml = strFromU8(files[`xl/worksheets/sheet${summaryId}.xml`]);
    const stylesXml = strFromU8(files["xl/styles.xml"]);
    const cellFormats = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    if (!cellFormats) throw new Error("Workbook cell formats missing");
    const formats = cellFormats[2].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) ?? [];
    expect(formats).toHaveLength(Number(cellFormats[1]));
    const durationIds = new Set([...stylesXml.matchAll(/<numFmt\b[^>]*>/g)]
      .filter(match => /\bformatCode="\[h\]:mm"/.test(match[0]))
      .map(match => match[0].match(/\bnumFmtId="(\d+)"/)?.[1]));
    expect(durationIds.size).toBe(1); expect(durationIds.has(undefined)).toBe(false);
    for (const [index, row] of rows.slice(4).entries()) {
      // Read the numeric Excel duration directly: a Date time-of-day would lose accumulated days.
      const duration = summaryXml.match(new RegExp(`<c r="J${index + 5}" s="(\\d+)"><v>([\\d.eE+-]+)</v></c>`));
      if (!duration) throw new Error(`Numeric shortage duration missing for row ${index + 5}`);
      const style = formats[Number(duration[1])], formatId = style?.match(/\bnumFmtId="(\d+)"/)?.[1];
      if (!style || !formatId) throw new Error(`Cell style missing for row ${index + 5}`);
      expect(durationIds.has(formatId)).toBe(true);
      expect(style).toContain('horizontal="right"'); expect(style).toContain('wrapText="1"');
      const sector = central.sectors.find(item => item.sector === row[0]);
      const expected = row[1] === "Confirmada" ? sector?.confirmed : sector?.estimated;
      if (expected?.deficitPersonMinutes === null || expected?.deficitPersonMinutes === undefined) throw new Error("Known shortage minutes required");
      expect(Number.isFinite(Number(duration[2]))).toBe(true);
      expect(Math.round(Number(duration[2]) * 1440)).toBe(expected?.deficitPersonMinutes);
      if (row[0] === "Setor") expect(Number(duration[2])).toBeGreaterThan(1);
    }
    for (const [path, value] of Object.entries(files)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      for (const match of strFromU8(value).matchAll(/<row[^>]* ht="([\d.]+)"/g)) expect(Number(match[1])).toBeLessThanOrEqual(409);
    }
    expect(workspace).toEqual(before);
  });
});
