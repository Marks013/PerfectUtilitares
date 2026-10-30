import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { addDays, dateRange, weekStart } from "./dates";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

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

describe("Escalas shared monthly presentation and real exports", () => {
  it("prioritizes a dense estimated staffing report while retaining every mandatory gap and every Excel row", async () => {
    const workspace = fixture();
    workspace.input.demands = Array.from({ length: 80 }, (_, index) => ({ id: `auto-${index}`, date: "2026-11-02", sector: `Setor estimado ${String(index).padStart(2, "0")}`, role: "Função", start: 480, end: 540, minimum: index + 1, estimated: true }));
    workspace.input.demands.push(...Array.from({ length: 28 }, (_, index) => ({ id: `hard-${index}`, date: "2026-11-03", sector: `Obrigatório ${String(index).padStart(2, "0")}`, role: "Função", start: 600, end: 660, minimum: 1, estimated: false })));
    const before = structuredClone(workspace);
    const pages = await pdfContent(await exportEscalaPdf(workspace));
    const text = pages.flat().map(item => item.str).join(" ");
    expect(text).toContain("24 de 80 grupos estimados");
    expect(text).toContain("aba Desfalques do Excel");
    expect(text).toContain("Setor estimado 79");
    expect(text).not.toContain("Setor estimado 00");
    for (let index = 0; index < 28; index++) expect(text).toContain(`Obrigatório ${String(index).padStart(2, "0")}`);
    expect(pages.length).toBeLessThanOrEqual(9); // A4 uses more pages than the former A3 report.
    const all = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(all.filter(row => /^2026-11-/.test(String(row[0])))).toHaveLength(108);
    expect(all.some(row => row[1] === "Setor estimado 00")).toBe(true);
    expect(workspace).toEqual(before);
  }, 20000);

  it("freezes useful identity columns and records complete print areas on every workbook sheet", () => {
    const archive = unzipSync(exportEscalaXlsx(fixture()));
    expect(strFromU8(archive["xl/worksheets/sheet1.xml"])).toContain('xSplit="5" ySplit="4" topLeftCell="F5"');
    for (const index of [2, 3]) expect(strFromU8(archive["xl/worksheets/sheet" + index + ".xml"])).toContain('xSplit="4" ySplit="4" topLeftCell="E5"');
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook.match(/name="_xlnm.Print_Area"/g)).toHaveLength(3);
    expect(workbook).toContain("'Horarios'!$A:$D");
    expect(workbook).toContain("'Escala'!$A:$E");
  });
  it("writes an actual monthly XLSX grid with frozen headers, safe text and secondary details", async () => {
    const workspace = fixture(), original = structuredClone(workspace), bytes = exportEscalaXlsx(workspace);
    const archive = unzipSync(bytes), main = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const rows = await readSheet(Buffer.from(bytes), "Escala");
    expect(rows[3]).toHaveLength(35);
    expect(rows[3].slice(0, 4)).toEqual(["Setor", "Matrícula", "Colaborador", "Cargo"]);
    expect(rows[3][5]).toBe("01/11 Dom");
    expect(rows[3].at(-1)).toBe("30/11 Seg");
    expect(rows.filter(row => row[1]).slice(1).map((row) => row[2])).toEqual(["Ana Gerente", "Áurea Silva"]);
    expect(rows.find(row => row[1] === "0002")).toContain("ENC");
    expect(rows.find(row => row[1] === "0001")).toContain("T02");
    expect(rows[4][0]).toBe("Setor: Reposição");
    const excluded = await readSheet(Buffer.from(bytes), "Excluidos");
    expect(excluded.find(row => row[0] === "X")).toContain("=1+1 Nome integral preservado");
    expect(excluded[4][0]).toBe("Setor: Reposição");
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
    expect(text).toContain(`${month}-01 a ${month}-${days}`);
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

  it("exports actionable deficit tables with exact dates, role, full interval and quantities", async () => {
    const workspace = fixture(); workspace.input.policy.coverageReview = "SUGGESTED";
    workspace.input.demands = ["2026-11-02", "2026-11-09"].flatMap((date, index) => [
      { id: `first-${index}`, date, sector: "Reposição", role: "Repositor", start: 480, end: 540, minimum: 3, estimated: true },
      { id: `second-${index}`, date, sector: "Reposição", role: "Repositor", start: 540, end: 600, minimum: 3, estimated: true },
    ]);
    workspace.input.demands.push({ id: "hard", date: "2026-11-03", sector: "Reposição", role: "Balconista", start: 600, end: 660, minimum: 1, estimated: false });
    workspace.validation.issues = [{ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING", date: "2026-11-02", message: "Mensagem antiga incompleta: a partir de 08:00." }];
    const before = structuredClone(workspace), bytes = await exportEscalaPdf(workspace);
    const pages = await pdfContent(bytes), text = pages.flat().map(item => item.str).join(" ");
    expect(text).toContain("Desfalques de cobertura");
    expect(text).toContain("Funções a revisar"); expect(text).toContain("Presentes");
    expect(text).not.toContain("Mensagem antiga incompleta");
    expect(text).not.toContain("situações distintas neste grupo");
    expect(text).toContain("Repositor: 1 presente(s), referência 3 estimada");
    expect(text).toContain("02/11, 09/11"); expect(text).toContain("08:00-10:00");
    expect(text).toContain("10:00-11:00"); expect(text).toContain("Mínimo informado");
    const table = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Desfalques");
    expect(table[3]).toEqual(["Data", "Setor", "Horário", "Presentes", "Referência", "Base", "Funções a revisar", "Situação"]);
    expect(table).toContainEqual(["2026-11-02", "Reposição", "Faixa analisada: 08:00-17:24\nDesfalque: 08:00-10:00", 1, 3, "Estimada", "Repositor: 1 presente(s), referência 3 estimada", "Abaixo da estimativa automática"]);
    expect(table).toContainEqual(["2026-11-03", "Reposição", "Faixa analisada: 08:00-17:24\nDesfalque: 10:00-11:00", 1, 1, "Mínimo informado", "Balconista: 0 presente(s), referência 1 informada", "Mínimo informado não atendido"]);
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
    expect(target?.[5]).toBe("08:00-12:00 / 12:15-14:05"); expect(target?.[7]).toBe("05:50");
    expect(rows[3]).not.toContain("Carga contratual");
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map(item => item.str).join(" ");
    expect(text).toContain("05:50 de jornada");
    expect(text).not.toContain("Referências curtas");
    expect(workspace.input.employees[0].weeklyHours).toBe(42);
    expect(workspace.input.employees[0].simulationDailyMinutes).toBe(350);
    expect(workspace.validation.issues).toHaveLength(2);
  }, 20000);

});

describe("separate rest and hourly exports", () => {
  it.each(["rest", "hours", "both"] as const)("exports the requested %s view as real PDF and XLSX with identical exact schedules", async (mode) => {
    const workspace = fixture(), before = structuredClone(workspace);
    const bytes = exportEscalaXlsx(workspace, mode), archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook.includes('name="Escala"')).toBe(mode !== "hours");
    expect(workbook.includes('name="Horarios"')).toBe(mode !== "rest");
    const excluded = await readSheet(Buffer.from(bytes), "Excluidos");
    expect(excluded.find(row => row[0] === "X")?.slice(0, 5)).toEqual(["X", "Reposição", "0003", "=1+1 Nome integral preservado", "Repositor"]);
    if (mode !== "rest") {
      const rows = await readSheet(Buffer.from(bytes), "Horarios");
      expect(rows.some((row) => row[1] === "0003")).toBe(false);
      const work = rows.find((row) => row[1] === "0001" && row[4] === "T02");
      expect(work?.slice(5, 8)).toEqual(["08:00-12:00 / 13:00-17:24", "12:00-13:00", "08:24"]);
      expect(rows.some((row) => row[1] === "0002" && row[4] === "ENC" && row[7] === "Não apurada")).toBe(true);
    }
    const text = (await pdfContent(await exportEscalaPdf(workspace, mode))).flat().map((item) => item.str).join(" ");
    expect(text.includes("Escala de folgas")).toBe(mode !== "hours");
    expect(text.includes("Escala de horários")).toBe(mode !== "rest");
    if (mode !== "hours") expect(text).toContain("ENC = Sem horário fixo");
    expect(text).toContain("Conferir a referência noturna");
    expect(workspace).toEqual(before);
  }, 20000);
});
