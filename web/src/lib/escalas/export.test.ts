import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { addDays, dateRange, weekStart } from "./dates";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";
import { buildEscalaSchedule } from "./presentation";
import { exportedDateISO, exportedDurationMinutes } from "./export-test-utils";
import { coverageBasis } from "./automatic-coverage";
import { analyzeCoverage } from "./coverage-analysis";

function fixture(month = "2026-11"): EscalaWorkspace {
  const person = { id: "p1", registration: "0001", name: "Áurea Silva", sector: "Reposição", role: "Repositor", weeklyHours: 42 as const,
    shiftIds: ["day", "unused"], activeFrom: "", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const,
    maxConsecutiveSundays: 1 as const, sundayRestRule: "PROTECTIVE" as const, preferredOffDays: [], historyKnown: false, history: [],
    sourceSchedule: { report: "FPRE136" as const, code: "011", description: "Original importado", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } };
  const first = `${month}-01`, [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const start = weekStart(first), end = addDays(weekStart(last), 6), dates = dateRange(start, end);
  return { id: "plan", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-27",
    input: { schemaVersion: 1, visibleMonth: month, branchCode: "08", branchName: "Filial de teste", startDate: start, endDate: end, defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "Cenário técnico", validFrom: "2026-01-01", validUntil: "2029-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
        minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [person, { ...person, id: "manager", registration: "0002", name: "Ana Gerente", role: "Gerente", scheduleMode: "UNTIMED", shiftIds: [] },
        { ...person, id: "excluded", registration: "0003", name: "=1+1 Nome integral preservado", planningEnabled: false, planningExclusionReason: "Conferir a referência noturna" }],
      shifts: [{ id: "unused", name: "Alternativa não selecionada", segments: [{ start: 420, end: 900, kind: "WORK" }] },
        { id: "day", name: "Horário utilizado", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
      demands: [], assignments: dates.flatMap((date, index) => [
        { employeeId: "p1", date, kind: index % 7 < 5 ? "WORK" as const : "OFF" as const, ...(index % 7 < 5 ? { shiftId: "day" } : {}) },
        { employeeId: "manager", date, kind: index % 7 < 5 ? "DUTY" as const : "OFF" as const },
      ]),
    },
    validation: { valid: true, readyToPublish: false, minimumCoverageMargin: null,
      issues: [{ code: "POLICY_PENDING", severity: "PENDING", message: "Confirmar a norma aplicável." }], summaries: [],
    },
  };
}

async function pdfContent(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await loading.promise;
  try {
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBe(842); expect(viewport.height).toBe(595);
      const items = content.items.filter((item) => "str" in item);
      for (const item of items) if ("transform" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
      }
      pages.push(items);
    }
    return pages;
  } finally { await loading.destroy(); }
}

describe("hours references without daily attendance", () => {
  it.each([false, true])("exports only real references with protected absence=%s", async (withAbsence) => {
    const workspace = fixture();
    workspace.input.generationMode = "HOURS_ONLY";
    workspace.input.employees = [workspace.input.employees[0]];
    workspace.input.employees[0].shiftIds = ["late8", "nine", "early8"];
    workspace.input.mixed42Sectors = ["Reposição"];
    workspace.input.shifts = [
      { id: "late8", name: "Oito horas tarde", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] },
      { id: "nine", name: "Nove horas", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 900, kind: "BREAK" }, { start: 900, end: 1200, kind: "WORK" }] },
      { id: "early8", name: "Oito horas cedo", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end: 960, kind: "WORK" }] },
    ];
    workspace.input.assignments = withAbsence ? [{ employeeId: "p1", date: "2026-11-03", kind: "ABSENCE", locked: true }] : [];
    workspace.input.demands = [{ id: "demand", sector: "Reposição", date: "2026-11-03", start: 480, end: 720, minimum: 6 }];
    const original = JSON.stringify(workspace.input);
    const model = buildEscalaSchedule(workspace.input);
    expect(model.dates).toEqual([]);
    expect(model.people[0].cells).toEqual([]);
    expect(model.restPeople).toEqual([]);
    expect(model.calendarLabel).toBe("");
    expect(model.holidayNotes).toEqual([]);
    expect(model.people[0].proposedVariants.map(row => row.shiftId)).toEqual(["early8", "late8", "nine"]);
    expect(model.people[0].proposedVariants.map(row => row.daily)).toEqual(["08:00", "08:00", "09:00"]);
    const bytes = Buffer.from(exportEscalaXlsx(workspace));
    const archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook).toContain('name="Horarios"');
    for (const name of ["Escala", "Capacidade", "Desfalques"]) expect(workbook).not.toContain(`name="${name}"`);
    const rows = await readSheet(bytes, "Horarios");
    expect(rows[1][0]).toContain("Referências de horários");
    expect(rows[2][0]).toContain("sem grade diária");
    expect(rows.slice(4).map(row => exportedDurationMinutes(row[7]))).toEqual([480, 480, 540]);
    expect(rows.slice(4).map(row => row[6])).toEqual(["11:00-12:00", "12:00-13:00", "12:00-15:00"]);
    expect(rows.slice(4).map(row => row[5])).toEqual(["07:00-11:00 / 12:00-16:00", "08:00-12:00 / 13:00-17:00", "08:00-12:00 / 15:00-20:00"]);
    const pages = await pdfContent(await exportEscalaPdf(workspace));
    const text = pages.flat().map(item => item.str).join(" ");
    expect(text).toContain("Referências de horários");
    expect(text).toContain("sem grade diária");
    expect(text).toContain("08:00-12:00 / 15:00-20:00");
    for (const forbidden of ["Capacidade nominal", "Desfalques de cobertura", "Escala de folgas", "Calendário:", "5x2", "F = Folga", "Aplicação nas semanas"]) expect(text).not.toContain(forbidden);
    expect(JSON.stringify(workspace.input)).toBe(original);
  });

  it("keeps distinct clocks of the same duration when both are used in a roster", () => {
    const workspace = fixture();
    const day = workspace.input.shifts.find(shift => shift.id === "day");
    if (!day) throw new Error("Day shift missing from the mixed-clock fixture");
    workspace.input.shifts = [day, { ...day, id: "earlier", segments: day.segments.map(segment => ({ ...segment, start: segment.start - 60, end: segment.end - 60 })) }];
    workspace.input.employees[0].shiftIds = ["day", "earlier"];
    workspace.input.generationMode = "HOURS_ONLY";
    workspace.input.assignments = [{ employeeId: "p1", date: "2026-11-03", kind: "WORK", shiftId: "day" }, { employeeId: "p1", date: "2026-11-04", kind: "WORK", shiftId: "earlier" }];
    const person = buildEscalaSchedule(workspace.input).people.find(row => row.employee.id === "p1");
    if (!person) throw new Error("Timed employee missing from the schedule presentation");
    expect(person.proposedVariants).toHaveLength(2);
    expect(new Set(person.proposedVariants.map(row => row.daily)).size).toBe(1);
    expect(person.proposedVariants.flatMap(row => row.dates).sort()).toEqual(["2026-11-03", "2026-11-04"]);
  });
});

describe("Escalas shared monthly presentation and real exports", () => {
  it("stores identifiers as text and durations as accumulated numeric time with compact calendar headers", async () => {
    const bytes = exportEscalaXlsx(fixture()), archive = unzipSync(bytes);
    const main = strFromU8(archive["xl/worksheets/sheet1.xml"]), hours = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const styles = strFromU8(archive["xl/styles.xml"]);
    expect(hours).toMatch(/<c r="B5"[^>]*t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>0001<\/t>/);
    const duration = /<c r="H5" s="(\d+)"[^>]*><v>([^<]+)<\/v><\/c>/.exec(hours);
    expect(duration).not.toBeNull();
    expect(Number(duration?.[2])).toBeCloseTo(480 / 1440, 12);
    const formats = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf\b[^>]*>/g) ?? [];
    expect(formats[Number(duration?.[1])]).toContain('numFmtId="164"');
    expect(styles).toContain('numFmtId="164" formatCode="[h]:mm"');
    expect(styles).toContain('numFmtId="165" formatCode="#,##0.00"');
    const rows = await readSheet(Buffer.from(bytes), "Escala");
    expect(rows[1][0]).toContain("Jornada escolhida: 42h");
    expect(rows[3][5]).toBe("01\nDom");
    expect(rows[3].at(-1)).toBe("30\nSeg");
    expect(main).toContain('<autoFilter ref="A4:AI6"/>');
    expect(main).toContain('xSplit="5" ySplit="4"');
  });
  it("does not describe an ENC duty day as nobody scheduled in PDF or XLSX", async () => {
    const workspace = fixture();
    workspace.input.policy.closedDates = dateRange("2026-11-01", "2026-11-30").filter(date => date !== "2026-11-03");
    workspace.input.assignments = [{ employeeId: "p1", date: "2026-11-03", kind: "OFF" }, { employeeId: "manager", date: "2026-11-03", kind: "DUTY" }];
    workspace.input.demands = [{ id: "unknown", sector: "Reposição", date: "2026-11-03", start: 480, end: 1044, minimum: 0, estimated: true }];
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    const table = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(table[2][0]).toContain("Trabalho com horário");
    expect(table[3][2]).toBe("Previstas com horário (pessoas)");
    expect(table[4][1]).toBe("Sem referência");
    expect(table[4][2]).toBe("—");
    expect(table[4][3]).toBe(0); expect(table[4][4]).toBe("—");
    expect(table[4][8]).toBe(0);
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map(item => item.str).join(" ");
    expect(text).toContain("Sem referência");
    expect(text).not.toContain("ninguém escalado");
  }, 20000);

  it("groups whole dates without timed presence once per sector, including zero estimates, in both real exports", async () => {
    const workspace = fixture();
    const person = workspace.input.employees[0];
    workspace.input.employees = [{ ...person, sector: "Zeta" }, { ...person, id: "p2", registration: "0004", name: "Pessoa Alfa", sector: "Alfa" }];
    workspace.input.policy.closedDates = dateRange("2026-11-01", "2026-11-30").filter(date => !["2026-11-02", "2026-11-03", "2026-11-04"].includes(date));
    workspace.input.assignments = workspace.input.employees.flatMap(employee => [
      { employeeId: employee.id, date: "2026-11-02", kind: "WORK" as const, shiftId: "day" },
      { employeeId: employee.id, date: "2026-11-03", kind: "OFF" as const },
      { employeeId: employee.id, date: "2026-11-04", kind: "ABSENCE" as const },
    ]);
    workspace.input.demands = workspace.input.employees.flatMap(employee => ["2026-11-03", "2026-11-04"].map(date => ({
      id: employee.id + date, date, sector: employee.sector, start: 480, end: 1044, minimum: employee.sector === "Zeta" && date === "2026-11-03" ? 1 : 0, estimated: true,
    })));
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    const before = structuredClone(workspace);
    const table = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(table.slice(4).map(row => row[0])).toEqual(["Alfa", "Zeta"]);
    expect(table[4][1]).toBe("Sem referência");
    expect(table[4][2]).toBe("—");
    expect(table[4][3]).toBe(0); expect(table[4][8]).toBe(0);
    expect(table[5][1]).toBe("Estimada");
    expect(exportedDateISO(table[5][5])).toBe("2026-11-03");
    expect(table[5][8]).toBe(1);
    const pages = await pdfContent(await exportEscalaPdf(workspace));
    const text = pages.flat().map(item => item.str).join(" ");
    const summary = text.slice(text.indexOf("Desfalques de cobertura"));
    expect(summary.indexOf("Alfa")).toBeLessThan(summary.indexOf("Zeta"));
    expect(summary).toContain("03/11/2026");
    expect(summary).toContain("Sem referência");
    expect(pages.length).toBeLessThanOrEqual(4);
    expect(workspace).toEqual(before);
  }, 20000);
  it("keeps every estimated and mandatory sector in alphabetical PDF order and every Excel row", async () => {
    const workspace = fixture();
    workspace.input.demands = Array.from({ length: 80 }, (_, index) => ({ id: `auto-${index}`, date: "2026-11-02", sector: `Setor estimado ${String(index).padStart(2, "0")}`, role: "Função", start: 480, end: 540, minimum: index + 1, estimated: true }));
    workspace.input.demands.push(...Array.from({ length: 28 }, (_, index) => ({ id: `hard-${index}`, date: "2026-11-03", sector: `Obrigatório ${String(index).padStart(2, "0")}`, role: "Função", start: 600, end: 660, minimum: 1, estimated: false })));
    const before = structuredClone(workspace);
    const pages = await pdfContent(await exportEscalaPdf(workspace));
    const text = pages.flat().map(item => item.str).join(" ");
    expect(text).not.toContain("24 de");
    for (let index = 0; index < 80; index++) expect(text).toContain(`Setor estimado ${String(index).padStart(2, "0")}`);
    for (let index = 0; index < 28; index++) expect(text).toContain(`Obrigatório ${String(index).padStart(2, "0")}`);
    expect(text.indexOf("Setor estimado 00")).toBeLessThan(text.indexOf("Setor estimado 79"));
    const all = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(all.slice(4)).toHaveLength(108);
    expect(all.some(row => row[0] === "Setor estimado 00")).toBe(true);
    expect(workspace).toEqual(before);
  }, 20000);

  it("freezes useful identity columns and records complete print areas on every workbook sheet", () => {
    const archive = unzipSync(exportEscalaXlsx(fixture()));
    expect(strFromU8(archive["xl/worksheets/sheet1.xml"])).toContain('xSplit="5" ySplit="4" topLeftCell="F5"');
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    const sheets = new Map([...workbook.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)"/g)].map(match => [match[1], match[2]]));
    for (const name of ["Horarios", "Excluidos"]) {
      expect(strFromU8(archive[`xl/worksheets/sheet${sheets.get(name)}.xml`])).toContain('xSplit="4" ySplit="4" topLeftCell="E5"');
    }
    expect(strFromU8(archive[`xl/worksheets/sheet${sheets.get("Capacidade")}.xml`])).toContain('xSplit="1" ySplit="4" topLeftCell="B5"');
    expect(workbook.match(/name="_xlnm.Print_Area"/g)).toHaveLength(sheets.size);
    expect(workbook).toContain("'Horarios'!$A:$D");
    expect(workbook).toContain("'Escala'!$A:$E");
  });
  it("writes an actual monthly XLSX grid with frozen headers, safe text and secondary details", async () => {
    const workspace = fixture(), original = structuredClone(workspace), bytes = exportEscalaXlsx(workspace);
    const archive = unzipSync(bytes), main = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const rows = await readSheet(Buffer.from(bytes), "Escala");
    expect(rows[3]).toHaveLength(35);
    expect(rows[3].slice(0, 4)).toEqual(["Setor", "Matrícula", "Colaborador", "Cargo"]);
    expect(rows[3][5]).toBe("01\nDom");
    expect(rows[3].at(-1)).toBe("30\nSeg");
    expect(rows.filter(row => row[1]).slice(1).map((row) => row[2])).toEqual(["Áurea Silva", "Ana Gerente"]);
    expect(rows.find(row => row[1] === "0002")).toContain("ENC");
    expect(rows.find(row => row[1] === "0001")).toContain("T02");
    expect(rows[4][0]).toBe("Reposição");
    const excluded = await readSheet(Buffer.from(bytes), "Excluidos");
    expect(excluded.find(row => row[0] === "X")).toContain("=1+1 Nome integral preservado");
    expect(excluded[4][1]).toBe("Reposição");
    expect(main).toContain('xSplit="5" ySplit="4"');
    expect(main).toContain('zoomScale="75"');
    expect(main).toContain('paperSize="9"');
    expect(main).toContain('r="1" ht="20"');
    expect(strFromU8(archive["xl/styles.xml"])).toContain('<left style="thin">');
    expect(main).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(main).not.toContain("<f>");
    expect(strFromU8(archive["xl/styles.xml"])).toContain('wrapText="1"');
    expect(strFromU8(archive["xl/workbook.xml"])).toContain("$1:$4");
    expect(strFromU8(archive["xl/worksheets/sheet3.xml"])).not.toContain("POLICY_PENDING");
    const hours = await readSheet(Buffer.from(bytes), "Horarios");
    expect(hours.flat()).toContain("T02");
    expect(hours.flat().join(" ")).toContain("08:00-12:00 / 13:00-17:24");
    expect(hours.flat().join(" ")).not.toContain("Alternativa não selecionada");
    expect(workspace.input.employees[0].sourceSchedule?.weekday).toBe("08:00-12:00 / 13:00-17:00");
    expect(workspace).toEqual(original);
  });

  it("keeps bold hourly cells and wrapped headings inside their actual PDF columns", async () => {
    const workspace = fixture();
    workspace.input.employees = [{ ...workspace.input.employees[0], name: "WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW", role: "Encarregado de atendimento e operações de supermercado" }];
    const widths = [0.27, 0.18, 0.05, 0.27, 0.15, 0.08].map(ratio => ratio * 790);
    const starts = widths.map((_, index) => 29 + widths.slice(0, index).reduce((sum, value) => sum + value, 0));
    const pages = await pdfContent(await exportEscalaPdf(workspace, "hours"));
    let checked = 0;
    for (const item of pages.flat()) {
      const index = starts.findIndex(start => Math.abs(start - item.transform[4]) < 0.1);
      if (index < 0) continue;
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(starts[index] + widths[index] - 6 + 0.1);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  }, 20000);

  it("fits workbook headings and metadata without turning every title into a dark band", () => {
    const archive = unzipSync(exportEscalaXlsx(fixture()));
    const main = strFromU8(archive["xl/worksheets/sheet1.xml"]), styles = strFromU8(archive["xl/styles.xml"]);
    const row = (document: string, index: number) => {
      const match = document.match(new RegExp(`<row r="${index}" ht="([\\d.]+)"[^>]*>([\\s\\S]*?)</row>`));
      if (!match) throw new Error(`Workbook row ${index} missing`);
      return { height: Number(match[1]), cells: match[2] };
    };
    const font = styles.match(/<font><sz val="([\d.]+)"/), metadata = main.match(/<c r="A2" s="(\d+)"/);
    if (!font || !metadata) throw new Error("Workbook font or metadata cell missing");
    // Two explicit calendar lines must fit the actual 10pt font; taller content must expand.
    const minimumHeight = (lines: number) => lines * Number(font[1]) * 1.3 + 4;
    const header = row(main, 4), date = header.cells.match(/<c r="F4"[^>]*><is><t[^>]*>([\s\S]*?)<\/t>/);
    if (!date) throw new Error("First calendar heading missing");
    expect(date[1].split("\n")).toEqual(["01", "Dom"]);
    expect(header.height).toBeGreaterThanOrEqual(minimumHeight(date[1].split("\n").length));
    const expanded = fixture();
    expanded.input.branchName = "Loja\ncom identificação\ncompleta";
    expanded.input.employees[0].name = "Nome integral\npreservado em\ntrês linhas";
    const expandedMain = strFromU8(unzipSync(exportEscalaXlsx(expanded))["xl/worksheets/sheet1.xml"]);
    for (const [index, value] of [[1, expanded.input.branchName], [5, expanded.input.employees[0].name]] as const) {
      const expandedRow = row(expandedMain, index);
      expect(expandedRow.cells).toContain(value);
      expect(expandedRow.height).toBeGreaterThan(row(main, index).height);
      expect(expandedRow.height).toBeGreaterThanOrEqual(minimumHeight(value.split("\n").length));
    }
    const formats = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    if (!formats) throw new Error("Workbook cell formats missing");
    const entries = formats[2].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) ?? [];
    expect(entries).toHaveLength(Number(formats[1]));
    expect(entries[Number(metadata[1])]).toContain('fontId="0" fillId="0" borderId="0"');
    expect(entries[Number(metadata[1])]).toContain('wrapText="1"');
    expect(main).toContain('<c r="A1" s="8"');
    expect(main).toContain('<c r="A5" s="3"');
    expect(main).toContain('<c r="F4" s="10"');
    expect(styles).toContain('<fonts count="3">');
    expect(styles).not.toMatch(/FF(?:00FF00|FFFF00)/);
  });

  it.each([["2026-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-12", 31]] as const)("keeps PDF/XLSX dates, people and each assignment identical for %s", async (month, days) => {
    const workspace = fixture(month), before = structuredClone(workspace);
    const xlsx = exportEscalaXlsx(workspace), rows = await readSheet(Buffer.from(xlsx), "Escala");
    const pdf = await exportEscalaPdf(workspace), pages = await pdfContent(pdf), all = pages.flat();
    const text = all.map((item) => item.str).join(" ");
    expect(rows[3]).toHaveLength(days + 5);
    expect(text).not.toContain("Resumo de carga e turnos");
    expect(text).not.toContain("Horas previstas");
    expect(text).not.toContain("POLICY_PENDING");
    expect(text).toContain("RASCUNHO");
    expect(text).toContain("Escala de horários");
    expect(text).toContain("08:00-12:00 / 13:00-17:24");
    expect(text).not.toContain("Conferência da proposta");
    expect(text).not.toContain("Alternativa não selecionada");
    expect(text).toContain(`01/${month.slice(5)}/${month.slice(0, 4)} a ${days}/${month.slice(5)}/${month.slice(0, 4)}`);
    const gridPage = pages.find((items) => items.some((item) => item.str === "0001 - Áurea Silva"));
    expect(gridPage).toBeDefined();
    for (const row of rows.slice(4).filter(row => row[1])) {
      const identity = gridPage?.find((item) => item.str === `${row[1]} - ${row[2]}`);
      expect(identity).toBeDefined();
      const cells = gridPage?.filter((item) => item.str.trim().length > 0 && "transform" in item && "transform" in (identity ?? {}) && Math.abs(item.transform[5] - (identity as { transform: number[] }).transform[5]) < 0.1 && item.transform[4] > 280).flatMap((item) => item.str.trim().split(/\s+/));
      expect(cells).toEqual(row.slice(5));
    }
    expect(workspace).toEqual(before);
  }, 20000);

  it("wraps complete long names and roles, repeats headers and stays compact across pages", async () => {
    const workspace = fixture();
    const longName = "Pessoa com nome completo muito extenso para comprovar que nenhuma parte do nome foi descartada na impressão profissional";
    workspace.input.employees = Array.from({ length: 65 }, (_, index) => ({ ...workspace.input.employees[0], id: `p${index}`, registration: String(index).padStart(4, "0"), name: index ? `Pessoa ${index}` : longName }));
    workspace.input.assignments = [];
    const bytes = await exportEscalaPdf(workspace, "rest"), document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeLessThanOrEqual(8); // Full names remain readable on A4.
    const pages = await pdfContent(bytes), text = pages.flat().map((item) => item.str).join(" ");
    expect(text.replace(/\s+/g, " ")).toContain(longName);
    expect(pages.filter((items) => items.some((item) => item.str === "Matrícula / colaborador")).length).toBeGreaterThan(1);
    expect(text).not.toContain("...");
  }, 20000);

  it("keeps repeated support issues in the source and out of operational files", async () => {
    const workspace = fixture();
    workspace.validation.issues = Array.from({ length: 120 }, (_, index) => ({ code: "COVERAGE_DEFICIT", severity: "ERROR", date: "2026-11-" + String(index % 30 + 1).padStart(2, "0"), message: "Suporte: verificar a cobertura." }));
    const before = structuredClone(workspace.validation), bytes = exportEscalaXlsx(workspace);
    const archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook).not.toContain('name="Conferencia"');
    expect(Object.values(archive).map(value => strFromU8(value)).join(" ")).not.toContain("Suporte: verificar a cobertura.");
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map(item => item.str).join(" ");
    expect(text).not.toMatch(/COVERAGE_DEFICIT|120 ocorrências|Conferência da proposta/);
    expect(workspace.validation).toEqual(before);
    expect(workspace.validation.issues).toHaveLength(120);
  }, 20000);

  it("preserves extensive support messages without adding oversized cells to operational Excel", async () => {
    const workspace = fixture(), messages = ["A".repeat(18000), "B".repeat(18000), "C".repeat(35000)];
    workspace.validation.issues = messages.map(message => ({ code: "TEST_REVIEW", severity: "ERROR", message }));
    const archive = unzipSync(exportEscalaXlsx(workspace));
    const cells = Object.entries(archive).filter(([name]) => name.startsWith("xl/worksheets/"))
      .flatMap(([, bytes]) => [...strFromU8(bytes).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]));
    expect(cells.every(cell => cell.length <= 30000)).toBe(true);
    expect(cells.join(" ")).not.toContain("A".repeat(100));
    expect(workspace.validation.issues.map(issue => issue.message)).toEqual(messages);
  });

  it("keeps legacy weekly drafts readable and handles unsafe XML and unsupported font characters", async () => {
    const workspace = fixture();
    delete workspace.input.visibleMonth;
    workspace.input.endDate = addDays(workspace.input.startDate, 6);
    workspace.status = "PUBLISHED";
    workspace.input.employees = [{ ...workspace.input.employees[0], name: '=Texto <integral> & "seguro" 😀\u0001\uffff' }];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Escala");
    expect(rows[3]).toHaveLength(12);
    expect(rows.find(row => row[1] === "0001")?.[2]).toBe('=Texto <integral> & "seguro" 😀');
    const bytes = await exportEscalaPdf(workspace), document = await PDFDocument.load(bytes);
    expect(document.getPages().every((page) => page.getWidth() === 842 && page.getHeight() === 595)).toBe(true);
    const text = (await pdfContent(bytes)).flat().map((item) => item.str).join(" ");
    expect(text).toContain("PUBLICADA");
    expect(text).toContain('=Texto <integral> & "seguro"');
  }, 20000);

  it("exports an empty draft without fake collaborators or hours", async () => {
    const workspace = fixture();
    workspace.input.employees = []; workspace.input.assignments = []; workspace.input.shifts = [];
    workspace.validation.issues = [];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Escala");
    expect(rows).toHaveLength(4);
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map((item) => item.str).join(" ");
    expect(text).toContain("Nenhum colaborador");
    expect(text).not.toContain("Conferência da proposta");
    expect(text).not.toContain("Horas previstas");
  }, 20000);

  it("summarizes affected dates independently by ruler with the actual role-aware peak", async () => {
    const workspace = fixture(); workspace.input.policy.coverageReview = "SUGGESTED";
    workspace.input.demands = ["2026-11-02", "2026-11-09"].flatMap((date, index) => [
      { id: `first-${index}`, date, sector: "Reposição", role: "Repositor", start: 480, end: 540, minimum: 3, estimated: true },
      { id: `second-${index}`, date, sector: "Reposição", role: "Repositor", start: 540, end: 600, minimum: 3, estimated: true },
    ]);
    workspace.input.demands.push({ id: "hard", date: "2026-11-03", sector: "Reposição", role: "Balconista", start: 600, end: 660, minimum: 1, estimated: false });
    workspace.validation.issues = [{ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING", date: "2026-11-02", message: "Mensagem antiga incompleta: a partir de 08:00." }];
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    const central = analyzeCoverage(workspace.input, workspace.input, { referenceOrigin: "PERSISTED", details: true }).sectors[0];
    const before = structuredClone(workspace), bytes = await exportEscalaPdf(workspace);
    const pages = await pdfContent(bytes), text = pages.flat().map(item => item.str).join(" ");
    expect(text).toContain("Desfalques de cobertura");
    expect(text).toContain("Confirmada"); expect(text).toContain("Estimada");
    expect(text).not.toContain("Funções / cargos a revisar");
    expect(text).not.toContain("Mensagem antiga incompleta");
    expect(text).not.toContain("situações distintas neste grupo");
    expect(text).not.toContain("Repositor: 1 presente(s)");
    expect(text).toContain("Maior desfalque (pessoas)"); expect(text).not.toContain("Geral:");
    expect(text).toContain("08:00-09:00"); expect(text).toContain("10:00-11:00");
    const table = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(table[3]).toEqual(["Setor", "Origem", "Previstas com horário (pessoas)", "Referência (pessoas)", "Maior desfalque (pessoas)", "Dia do maior desfalque", "Horário do maior desfalque", "Duração da faixa", "Dias com falta no período", "Falta acumulada (horas da equipe)", "Tempo com falta no período", "Observado no pico"]);
    const rows = table.slice(4);
    expect(rows).toHaveLength(2); expect(rows.every(row => row[0] === "Reposição")).toBe(true);
    const confirmed = rows.find(row => row[1] === "Confirmada"), estimated = rows.find(row => row[1] === "Estimada");
    if (!confirmed || !estimated) throw new Error("Independent confirmed and estimated export rows are required");
    expect(confirmed[2]).toBe(1); expect(confirmed[3]).toBe(1); expect(confirmed[4]).toBe(1);
    expect(estimated[2]).toBe(1); expect(estimated[3]).toBe(3); expect(estimated[4]).toBe(2);
    expect(exportedDateISO(confirmed[5])).toBe("2026-11-03"); expect(confirmed[6]).toBe("10:00-11:00");
    expect(exportedDateISO(estimated[5])).toBe("2026-11-02"); expect(estimated[6]).toBe("08:00-09:00");
    expect(confirmed[8]).toBe(1); expect(estimated[8]).toBe(2);
    expect(exportedDurationMinutes(confirmed[9])).toBe(central.confirmed?.deficitPersonMinutes);
    expect(exportedDurationMinutes(estimated[9])).toBe(central.estimated?.deficitPersonMinutes);
    expect(workspace).toEqual(before);
  }, 20000);

  it("preserves critical and boundary diagnostics in application data rather than operational exports", async () => {
    const workspace = fixture();
    workspace.validation.issues = [
      ...Array.from({ length: 9 }, (_, index) => ({ code: "HISTORY_UNVERIFIED", severity: "WARNING" as const, employeeId: ["p1", "manager", "excluded"][index % 3], date: "2026-10-26", message: "Histórico anterior não conferido: detalhe técnico preservado." })),
      { code: "INTER_SHIFT_REST", severity: "ERROR", employeeId: "p1", date: "2026-10-31", message: "Descanso técnico de fronteira: 500 minutos." },
      { code: "WORK_STREAK", severity: "ERROR", employeeId: "p1", date: "2026-11-02", message: "Sequência crítica de 7 jornadas; máximo de 6." },
    ];
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map(item => item.str).join(" ");
    expect(text).not.toContain("Histórico anterior não conferido");
    expect(text).not.toContain("Sequência crítica");
    expect(text).not.toContain("Descanso técnico de fronteira: 500 minutos.");
    expect(text).not.toContain("verificação entre períodos");
    const archive = unzipSync(exportEscalaXlsx(workspace));
    expect(strFromU8(archive["xl/workbook.xml"])).not.toContain('name="Conferencia"');
    expect(workspace.validation.issues).toHaveLength(11);
    expect(workspace.validation.issues.at(-1)?.message).toBe("Sequência crítica de 7 jornadas; máximo de 6.");
    expect(workspace.validation.issues[9].message).toBe("Descanso técnico de fronteira: 500 minutos.");
  }, 20000);


  it("exports effective hours without turning a simulation target into a contractual claim", async () => {
    const workspace = fixture(); workspace.input.simulation = true;
    workspace.input.employees[0].simulationDailyMinutes = 350;
    workspace.input.shifts[1].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 735, kind: "BREAK" }, { start: 735, end: 845, kind: "WORK" }];
    workspace.validation.issues = ["p1", "manager"].map(employeeId => ({ code: "SHORT_REFERENCE_PRESERVED", severity: "PENDING", employeeId, message: "Referência curta individual preservada." }));
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Horarios");
    const target = rows.find(row => row[1] === "0001");
    expect(target?.[5]).toBe("08:00-12:00 / 12:15-14:05"); expect(exportedDurationMinutes(target?.[7])).toBe(350);
    expect(rows[3]).not.toContain("Carga contratual");
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map(item => item.str).join(" ");
    expect(text).toContain("05:50");
    expect(text).not.toContain("Referências curtas");
    expect(workspace.input.employees[0].weeklyHours).toBe(42);
    expect(workspace.input.employees[0].simulationDailyMinutes).toBe(350);
    expect(workspace.validation.issues).toHaveLength(2);
  }, 20000);

});

describe("separate rest and hourly exports", () => {
  it("omits sectors without rest participants rather than creating empty rest pages", async () => {
    const workspace = fixture();
    workspace.input.employees.push({ ...workspace.input.employees[0], id: "apprentice", registration: "0004", name: "Aprendiz", role: "AUX. DE SERVIÇOS EM SUPER", sector: "Setor só com aprendiz" });
    workspace.input.demands = [{ id: "gap-only", date: "2026-11-02", sector: "Setor só estimado", start: 480, end: 540, minimum: 1, estimated: true }];
    const pages = await pdfContent(await exportEscalaPdf(workspace, "rest"));
    const text = pages.flat().map(item => item.str).join(" ");
    expect(pages).toHaveLength(1);
    expect(text).not.toContain("Setor só com aprendiz");
    expect(text).not.toContain("Setor só estimado");
    expect(text).not.toContain("Desfalques de cobertura");
  }, 20000);
  it.each((["rest", "hours", "both"] as const).flatMap(mode => [true, false].map(separateSectors => ({ mode, separateSectors }))))("exports the requested $mode view with separateSectors=$separateSectors as real PDF and XLSX", async ({ mode, separateSectors }) => {
    const workspace = fixture();
    workspace.input.demands = [{ id: "gap", date: "2026-11-02", sector: "Reposição", start: 480, end: 540, minimum: 3, estimated: true }];
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    const before = structuredClone(workspace);
    const bytes = exportEscalaXlsx(workspace, mode), archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect((workbook.match(/name="Desfalques"/g) ?? []).length).toBe(mode === "rest" ? 0 : 1);
    expect(Object.values(archive).map(value => strFromU8(value)).join(" ")).not.toMatch(/Variantes reais permanecem separadas|Até 3 faixas prioritárias|Não some picos/);
    expect(workbook.includes('name="Escala"')).toBe(mode !== "hours");
    expect(workbook.includes('name="Horarios"')).toBe(mode !== "rest");
    const excluded = await readSheet(Buffer.from(bytes), "Excluidos");
    expect(excluded.find(row => row[0] === "X")?.slice(0, 5)).toEqual(["X", "Reposição", "0003", "=1+1 Nome integral preservado", "Repositor"]);
    if (mode !== "rest") {
      const rows = await readSheet(Buffer.from(bytes), "Horarios");
      const excludedReference = rows.find(row => row[1] === "0003");
      expect(excludedReference?.slice(5, 7)).toEqual(["07:00-15:00 — Referência base: 01/11/2026 a 30/11/2026", "Sem intervalo informado"]);
      expect(exportedDurationMinutes(excludedReference?.[7])).toBe(480);
      expect(workspace.input.assignments.filter(row => row.employeeId === "excluded")).toEqual([]);
      const work = rows.find((row) => row[1] === "0001" && row[4] === "T02");
      expect(work?.slice(5, 7)).toEqual(["08:00-12:00 / 13:00-17:24", "12:00-13:00"]);
      expect(exportedDurationMinutes(work?.[7])).toBe(504);
      expect(rows.some((row) => row[1] === "0002" && row[4] === "ENC" && row[7] === "Não apurada")).toBe(true);
    }
    const text = (await pdfContent(await exportEscalaPdf(workspace, mode, { separateSectors }))).flat().map((item) => item.str).join(" ");
    expect(text.includes("Desfalques de cobertura")).toBe(mode !== "rest");
    expect(text).not.toMatch(/Um resumo por setor, sem repetir cargos|Até 3 faixas prioritárias|Os picos não se somam|Variantes reais permanecem separadas/);
    if (mode !== "rest") expect(text).toContain("Maior desfalque (pessoas)");
    expect(text.includes("Escala de folgas")).toBe(mode !== "hours");
    expect(text.includes("Escala de horários")).toBe(mode !== "rest");
    if (mode !== "hours") expect(text).toContain("ENC = Sem horário fixo");
    expect(text).toContain("Conferir a referência noturna");
    expect(workspace).toEqual(before);
  }, 20000);
});
