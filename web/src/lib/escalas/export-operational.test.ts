import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { newInput, newEmployee } from "@/components/escalas/workspace-model";
import type { EscalaWorkspace } from "./types";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { coverageBasis } from "./automatic-coverage";
import { exportedDateISO } from "./export-test-utils";

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
  input.coverageBasis = coverageBasis(input);
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
  it.each(["rest", "hours", "both"] as const)("keeps each sector's %s view on exclusive pages with shortages only in hourly modes", async (mode) => {
    const source = scenario();
    source.input.demands.push({ id: "other", date: "2026-11-02", sector: "Açougue", start: 480, end: 1080, minimum: 1, estimated: true });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument(pdfJsServerDocumentOptions(await exportEscalaPdf(source, mode)));
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(2);
      const pages = await Promise.all([1, 2].map(async number => {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        return content.items.filter(item => "str" in item).map(item => item.str).join(" ");
      }));
      expect(pages[0]).toContain("Setor: Açougue");
      expect(pages[0]).toContain("03 - Bia");
      expect(pages[0]).not.toContain("Padaria");
      expect(pages[1]).toContain("Setor: Padaria");
      expect(pages[1]).toContain("01 - Zélia");
      expect(pages[1]).not.toContain("Açougue");
      for (const page of pages) {
        expect(page.includes("Desfalques de cobertura")).toBe(mode !== "rest");
        if (mode !== "rest") expect(page).toContain("Horários propostos por colaborador.");
        if (mode !== "hours") expect(page).toContain("Matrícula / colaborador");
      }
    } finally { await task.destroy(); }
  });

  it("continues a large sector on exclusive pages before moving to the next sector", async () => {
    const source = scenario();
    const person = source.input.employees[0];
    for (let index = 0; index < 38; index++) {
      const id = `extra-${index}`;
      source.input.employees.push({ ...person, id, registration: String(100 + index), name: `Pessoa ${index}` });
    }
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument(pdfJsServerDocumentOptions(await exportEscalaPdf(source, "rest")));
    const document = await task.promise;
    try {
      expect(document.numPages).toBeGreaterThan(3);
      for (let number = 2; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const text = content.items.filter(item => "str" in item).map(item => item.str).join(" ");
        expect(text).toContain("Setor: Padaria");
        expect(text).not.toContain("Açougue");
      }
    } finally { await task.destroy(); }
  });

  it("keeps Excel filtering over records only without frozen panes or repeated print titles", () => {
    const archive = unzipSync(exportEscalaXlsx(scenario()));
    expect(strFromU8(archive["xl/workbook.xml"])).not.toContain("_xlnm.Print_Titles");
    for (const [path, data] of Object.entries(archive)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      const xml = strFromU8(data);
      expect(xml).not.toContain("Setor:");
      expect([...xml.matchAll(/<mergeCell ref="[^"]+"/g)]).toHaveLength(3);
      expect(xml).not.toMatch(/<pane\b|state="frozen"|xSplit=|ySplit=|selection pane=/);
      expect(xml).toContain('<selection activeCell="A1" sqref="A1"/>');
      const last = xml.match(/<dimension ref="A1:([A-Z]+\d+)"\/>/)?.[1];
      expect(last).toBeTruthy();
      expect(xml).toContain('<autoFilter ref="A4:' + last + '"/>');
      expect(xml).toContain('<row r="4"');
    }
  });

  it("exports only selected operational views, retaining data without support worksheets", async () => {
    const source = scenario(), before = structuredClone(source);
    const archive = unzipSync(exportEscalaXlsx(source)), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1])).toEqual(["Escala", "Horarios", "Capacidade", "Desfalques"]);
    expect(workbook).not.toMatch(/Conferencia|Jornadas|Turnos/);
    expect(source).toEqual(before);
  });
  it("marks the mixed 42h draft as a negotiation in PDF and every Excel sheet", async () => {
    const source = scenario();
    source.input.simulation = true;
    source.input.mixed42Sectors = ["Padaria"];
    source.input.shifts[1].segments = [
      { start: 540, end: 810, kind: "WORK" },
      { start: 810, end: 990, kind: "BREAK" },
      { start: 990, end: 1260, kind: "WORK" },
    ];
    const before = structuredClone(source);
    const expected = "SIMULAÇÃO / NEGOCIAÇÃO: 3 × 8h + 2 × 9h nos setores selecionados; intervalo de 3h nos dias de 9h. Não é autorização operacional.";
    const workbook = Buffer.from(exportEscalaXlsx(source));
    for (const sheet of ["Escala", "Horarios", "Desfalques"]) {
      expect((await readSheet(workbook, sheet))[2][0]).toContain(expected);
    }
    const pdf = await pdfText(await exportEscalaPdf(source));
    expect(pdf).toContain(expected);
    expect(pdf).toContain("09:00-13:30 / 16:30-21:00");
    expect(source).toEqual(before);
  }, 20000);

  it("does not mark an ordinary 42h simulation as a mixed negotiation", async () => {
    const source = scenario();
    source.input.simulation = true;
    const workbook = Buffer.from(exportEscalaXlsx(source));
    expect((await readSheet(workbook, "Horarios"))[2][0]).not.toContain("NEGOCIAÇÃO");
    expect(await pdfText(await exportEscalaPdf(source))).not.toContain("NEGOCIAÇÃO");
  }, 20000);

  it("separates sectors and groups exact schedules before names and roles without day lists", async () => {
    const bytes = exportEscalaXlsx(scenario(), "hours"), rows = await readSheet(Buffer.from(bytes), "Horarios");
    expect(rows.slice(4).map(row => row[0])).toEqual(["Açougue", "Padaria", "Padaria", "Padaria"]);
    expect(rows.slice(4).every(row => row[1] && row[2])).toBe(true);
    const people = rows.filter(row => ["01", "02", "03"].includes(String(row[1])));
    expect(people.map(row => row[1])).toEqual(["03", "02", "01", "01"]);
    expect(people.filter(row => row[1] === "01").map(row => row[5])).toEqual(["08:00-12:00 / 13:00-17:24", "09:00-13:00 / 14:00-18:24"]);
    expect(rows.flat().join(" ")).not.toMatch(/2026-11-02|02\/11|Dia\(s\)|Dias com/);
  });
  it("uses the same sector, proposed-clock and name order in rest PDF and Excel without duplicating people", async () => {
    const source = scenario(), before = structuredClone(source);
    const rows = (await readSheet(Buffer.from(exportEscalaXlsx(source, "rest")), "Escala")).slice(4);
    expect(rows.map(row => row[1])).toEqual(["03", "02", "01"]);
    expect(rows.map(row => row[2])).toEqual(["Bia", "Ana", "Zélia"]);
    const text = await pdfText(await exportEscalaPdf(source, "rest"));
    expect(text.indexOf("03 - Bia")).toBeLessThan(text.indexOf("02 - Ana"));
    expect(text.indexOf("02 - Ana")).toBeLessThan(text.indexOf("01 - Zélia"));
    expect(text.match(/01 - Zélia/g)).toHaveLength(1);
    expect(source).toEqual(before);
  }, 20000);
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
    const text = await pdfText(await exportEscalaPdf(scenario(), "hours", { separateSectors: false }));
    expect(text).toContain("08:00-12:00 / 13:00-17:24");
    expect(text).toContain("09:00-13:00 / 14:00-18:24");
    const schedule = text.split("Horários propostos por colaborador.")[1].split("Desfalques de cobertura")[0];
    expect(schedule).not.toMatch(/02\/11|03\/11|Dia\(s\)|Folga/);
    expect(text).not.toMatch(/Conferência da proposta|Informação administrativa|certifica conformidade|Histórico anterior/);
  }, 20000);
  it("keeps a compact sector summary with the central peak occurrence in both files", async () => {
    const source = scenario(), rows = await readSheet(Buffer.from(exportEscalaXlsx(source)), "Desfalques");
    expect(rows.slice(4)).toHaveLength(1);
    expect(rows[4][0]).toBe("Padaria");
    expect(rows[4][1]).toBe("Estimada");
    expect(rows[4][4]).toBe(1);
    expect(rows[4]).toHaveLength(12);
    expect(exportedDateISO(rows[4][5])).toBe("2026-11-02");
    expect(rows[4][6]).toBe("12:00-13:00");
    const text = await pdfText(await exportEscalaPdf(source));
    expect(text).not.toContain("Faixa analisada:");
    expect(text).toContain("Data / faixa do pico");
    expect(text).toContain("Escalados na faixa");
    expect(text).toContain("12:00-13:00");
    expect(text).toContain("Estimada");
  }, 20000);

  it("keeps accented sectors grouped without turning an unknown TIMED cohort into numeric peaks", async () => {
    const source = scenario();
    source.input.employees = []; source.input.assignments = []; source.input.shifts = [];
    source.input.demands = [
      { id: "fruit", date: "2026-11-02", sector: "Hortifrúti", role: "Atendente", start: 480, end: 540, minimum: 1, estimated: true },
      { id: "later", date: "2026-11-02", sector: "Açougue", role: "Zelador", start: 840, end: 900, minimum: 1, estimated: true },
      ...["2026-11-09", "2026-11-03", "2026-11-02"].flatMap((date, index) => [
        { id: "z-" + index, date, sector: "Açougue", role: "Zelador", start: 480, end: 540, minimum: 1, estimated: true },
        { id: "a-" + index, date, sector: "Açougue", role: "Auxiliar", start: 480, end: 540, minimum: index === 0 ? 2 : 1, estimated: true },
      ]),
      { id: "duplicate", date: "2026-11-02", sector: "Açougue", role: "Auxiliar", start: 480, end: 540, minimum: 1, estimated: true },
    ];
    source.input.coverageBasis = coverageBasis(source.input);
    const before = structuredClone(source);
    const rows = (await readSheet(Buffer.from(exportEscalaXlsx(source)), "Desfalques")).slice(4);
    expect(rows.map(row => row[0])).toEqual(["Açougue", "Hortifrúti"]);
    expect(rows[0][1]).toBe("Estimada · parcial");
    expect(rows[0].slice(2, 11)).toEqual(Array(9).fill("—"));
    expect(rows[1].slice(2, 11)).toEqual(Array(9).fill("—"));
    expect(rows.flat().join(" ")).not.toMatch(/Auxiliar:|Zelador:/);
    const text = await pdfText(await exportEscalaPdf(source, "hours"));
    expect(text.indexOf("Açougue")).toBeLessThan(text.indexOf("Hortifrúti"));
    expect(text).not.toMatch(/Auxiliar:|Zelador:/);
    expect(text).toContain("Estimada · parcial");
    expect(text).not.toContain("Faixa analisada:");
    expect(text).not.toContain("Até 3 pessoa(s)");
    expect(text).not.toContain("24 de");
    expect(source).toEqual(before);
  }, 20000);
});
