import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { newInput, newEmployee } from "@/components/escalas/workspace-model";
import type { EscalaWorkspace } from "./types";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";

function scenario(): EscalaWorkspace {
  const input = newInput("08", "Loja sintética", "2026-11", 42);
  input.shifts = [
    { id: "a", name: "Manhã", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] },
    { id: "b", name: "Tarde", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] },
  ];
  input.employees = [
    { ...newEmployee(42, "a"), id: "p", registration: "01", name: "Zélia", sector: "Padaria", role: "Auxiliar" },
    { ...newEmployee(42, "a"), id: "q", registration: "02", name: "Ana", sector: "Padaria", role: "Padeiro" },
    { ...newEmployee(42, "a"), id: "r", registration: "03", name: "Bia", sector: "Açougue", role: "Balconista" },
  ];
  input.assignments = [
    { employeeId: "p", date: "2026-11-02", kind: "WORK", shiftId: "a" },
    { employeeId: "p", date: "2026-11-03", kind: "WORK", shiftId: "b" },
    { employeeId: "q", date: "2026-11-02", kind: "WORK", shiftId: "a" },
    { employeeId: "r", date: "2026-11-02", kind: "WORK", shiftId: "a" },
  ];
  input.demands = [{ id: "d", date: "2026-11-02", sector: "Padaria", start: 480, end: 1080, minimum: 1, estimated: true }];
  return { id: "proof", revision: 9, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-10-29", input,
    validation: { valid: true, readyToPublish: false, summaries: [], minimumCoverageMargin: null,
      issues: [{ code: "HISTORY_UNVERIFIED", severity: "WARNING", message: "Informação administrativa de suporte" }] } };
}
async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      for (const item of content.items) if ("str" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
      }
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
    }
    return pages.join(" ");
  } finally { await task.destroy(); }
}

describe("lean operational files", () => {
  it("keeps Excel filtering over records only and selects the usable frozen pane", () => {
    const archive = unzipSync(exportEscalaXlsx(scenario()));
    for (const [path, data] of Object.entries(archive)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      const xml = strFromU8(data);
      expect(xml).not.toContain("Setor:");
      expect([...xml.matchAll(/<mergeCell ref="[^"]+"/g)]).toHaveLength(3);
      expect(xml).toContain('<selection pane="bottomRight"');
      const editable = xml.match(/topLeftCell="([A-Z]+5)"/)?.[1];
      expect(editable).toBeTruthy();
      expect(xml).toContain('activeCell="' + editable + '"');
      expect(xml).toContain('sqref="' + editable + '"');
    }
  });

  it("exports only selected operational views, retaining data without support worksheets", async () => {
    const source = scenario(), before = structuredClone(source);
    const archive = unzipSync(exportEscalaXlsx(source)), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1])).toEqual(["Escala", "Horarios", "Desfalques"]);
    expect(workbook).not.toMatch(/Conferencia|Jornadas|Turnos/);
    expect(source).toEqual(before);
  });
  it("separates sectors and groups exact schedules before roles and names without day lists", async () => {
    const bytes = exportEscalaXlsx(scenario(), "hours"), rows = await readSheet(Buffer.from(bytes), "Horarios");
    expect(rows.slice(4).map(row => row[0])).toEqual(["Açougue", "Padaria", "Padaria", "Padaria"]);
    expect(rows.slice(4).every(row => row[1] && row[2])).toBe(true);
    const people = rows.filter(row => ["01", "02", "03"].includes(String(row[1])));
    expect(people.map(row => row[1])).toEqual(["03", "01", "02", "01"]);
    expect(people.filter(row => row[1] === "01").map(row => row[5])).toEqual(["08:00-12:00 / 13:00-17:24", "09:00-13:00 / 14:00-18:24"]);
    expect(rows.flat().join(" ")).not.toMatch(/2026-11-02|02\/11|Dia\(s\)|Dias com/);
  });
  it("keeps an apprentice out of rest grids while preserving the hourly view", async () => {
    const source = scenario();
    source.input.employees.push({ ...source.input.employees[0], id: "learner", registration: "99", name: "Aprendiz Sintético", role: "AUX. DE SERVIÇOS EM SUPER" });
    source.input.assignments.push({ employeeId: "learner", date: "2026-11-02", kind: "WORK", shiftId: "a" });
    const bytes = exportEscalaXlsx(source);
    const rest = await readSheet(Buffer.from(bytes), "Escala"), hours = await readSheet(Buffer.from(bytes), "Horarios");
    expect(rest.some(row => row[1] === "99")).toBe(false);
    expect(hours.some(row => row[1] === "99")).toBe(true);
    expect(await pdfText(await exportEscalaPdf(source, "rest"))).not.toContain("Aprendiz Sintético");
    expect(await pdfText(await exportEscalaPdf(source, "hours"))).toContain("Aprendiz Sintético");
  });
  it("prints only proposed schedule variants and excludes support warnings", async () => {
    const text = await pdfText(await exportEscalaPdf(scenario(), "hours"));
    expect(text).toContain("08:00-12:00 / 13:00-17:24");
    expect(text).toContain("09:00-13:00 / 14:00-18:24");
    const schedule = text.split("Horários propostos por colaborador.")[1].split("Desfalques de cobertura")[0];
    expect(schedule).not.toMatch(/02\/11|03\/11|Dia\(s\)|Folga/);
    expect(text).not.toMatch(/Conferência da proposta|Informação administrativa|certifica conformidade|Histórico anterior/);
  }, 20000);
  it("shows the whole analyzed window and highlights the exact staffing gap", async () => {
    const source = scenario(), rows = await readSheet(Buffer.from(exportEscalaXlsx(source)), "Desfalques");
    const deficit = rows.find(row => String(row[2]).includes("Desfalque: 12:00-13:00"));
    expect(deficit?.[2]).toContain("Faixa analisada: 08:00-18:00");
    const text = await pdfText(await exportEscalaPdf(source));
    expect(text).toContain("Faixa analisada: 08:00-18:00");
    expect(text).toContain("Desfalque: 12:00-13:00");
    expect(text).toContain("Estimada");
  }, 20000);
});
