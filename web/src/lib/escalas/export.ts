import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import type { EscalaEmployee, EscalaWorkspace } from "./types";
import { sortEmployees } from "./order";
import { effectiveWeeklyHours, weeklyTargets } from "./labor-rules";

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let day = Date.parse(`${start}T00:00:00Z`); day <= Date.parse(`${end}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
function duration(minutes: number) { return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`; }
function xml(value: unknown) {
  const text = [...String(value ?? "")].filter((character) => character.charCodeAt(0) >= 32 || [9, 10, 13].includes(character.charCodeAt(0))).join("");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function column(index: number) {
  let name = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}
function sheet(rows: (string | number)[][]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((row, index) => `<row r="${index + 1}">${row.map((value, cell) => typeof value === "number"
    ? `<c r="${column(cell)}${index + 1}"><v>${value}</v></c>`
    : `<c r="${column(cell)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${column(rows[0].length - 1)}${rows.length}"/></worksheet>`;
}

function exportRows(workspace: EscalaWorkspace) {
  const { input } = workspace;
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const assignments = new Map(input.assignments.map((assignment) => [`${assignment.employeeId}\0${assignment.date}`, assignment]));
  const rows: (string | number)[][] = [["Filial", "Setor", "Cargo", "Matrícula", "Nome", "Data", "Situação", "Horário", "Minutos de jornada", "Carga semanal de referência", "Versão", "Estado", "Carga vigente nesta semana", "Regra dominical"]];
  for (const employee of sortEmployees(input.employees)) {
    for (const date of datesBetween(input.startDate, input.endDate)) {
      const item = assignments.get(`${employee.id}\0${date}`);
      const shift = item?.kind === "WORK" ? shifts.get(item.shiftId ?? "") : undefined;
      const minutes = shift?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0) ?? 0;
      const schedule = shift?.segments.filter((segment) => segment.kind === "WORK").map((segment) => `${duration(segment.start)}-${duration(segment.end)}`).join(" / ") ?? "";
      const state = employee.planningEnabled === false ? "Fora da geração" : date < employee.activeFrom || (employee.activeUntil && date > employee.activeUntil) ? "Fora do vínculo" : !item ? "Não definido" : item.kind === "OFF" ? "Folga" : item.kind === "ABSENCE" ? "Ausência" : item.kind === "DUTY" ? "Trabalho sem horário fixo" : "Trabalho";
      rows.push([`${input.branchCode} - ${input.branchName}`, employee.sector, employee.role, employee.registration, employee.name, date, state, schedule, employee.scheduleMode === "UNTIMED" ? "Não apurados" : minutes, employee.scheduleMode === "UNTIMED" ? "Sem horário fixo" : employee.weeklyHours, workspace.revision, workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho", employee.scheduleMode === "UNTIMED" ? "Não apurada" : employee.planningEnabled === false ? 0 : effectiveWeeklyHours(employee, date), employee.sundayRestRule === "COMMERCE" && employee.maxConsecutiveSundays === 2 ? "Comércio: uma folga em três domingos" : "Quinzenal protetiva"]);
    }
  }
  return rows;
}

export function exportEscalaXlsx(workspace: EscalaWorkspace): Uint8Array {
  const rows = exportRows(workspace);
  const issues: (string | number)[][] = [["Estado", "Código", "Colaborador", "Data", "Conferência"]];
  const names = new Map(workspace.input.employees.map((employee) => [employee.id, `${employee.registration} - ${employee.name}`]));
  for (const issue of workspace.validation.issues) issues.push([issue.severity === "ERROR" ? "Impedimento" : issue.severity === "WARNING" ? "Limite de conferência" : "Pendência", issue.code, issue.employeeId ? names.get(issue.employeeId) ?? "" : "", issue.date ?? "", issue.message]);
  if (issues.length === 1) issues.push(["Conferido", "", "", "", "Sem impedimentos ou pendências nesta versão."]);
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Escala" sheetId="1" r:id="rId1"/><sheet name="Conferencia" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(sheet(rows)),
    "xl/worksheets/sheet2.xml": strToU8(sheet(issues)),
  }, { level: 6 });
}

function safePdfText(text: string, font: PDFFont) {
  return [...text.replace(/[\r\n\t]+/g, " ")].map((character) => {
    try { font.encodeText(character); return character; } catch { return "?"; }
  }).join("");
}
function fitText(text: string, width: number, font: PDFFont, size: number) {
  const safe = safePdfText(text, font);
  if (font.widthOfTextAtSize(safe, size) <= width) return safe;
  let shortened = safe;
  while (shortened && font.widthOfTextAtSize(`${shortened}...`, size) > width) shortened = shortened.slice(0, -1);
  return `${shortened}...`;
}

export async function exportEscalaPdf(workspace: EscalaWorkspace): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const { input } = workspace;
  const employees = sortEmployees(input.employees.filter((person) => person.planningEnabled !== false));
  const assignments = new Map(input.assignments.map((item) => [`${item.employeeId}\0${item.date}`, item]));
  const summaries = new Map(workspace.validation.summaries.map((item) => [item.employeeId, item]));
  const allDates = datesBetween(input.startDate, input.endDate);
  const shiftCodes = new Map(input.shifts.map((shift, index) => [shift.id, `T${String(index + 1).padStart(2, "0")}`]));
  const width = 842, height = 595, margin = 26, labelWidth = 270, cellWidth = (width - 2 * margin - labelWidth) / 7;
  let page!: PDFPage;
  let y = 0;
  const write = (text: string, x: number, lineY: number, size = 10, strong = false, maxWidth = width - 2 * margin) => {
    const selected = strong ? bold : font;
    page.drawText(fitText(text, maxWidth, selected, size), { x, y: lineY, size, font: selected, color: rgb(0.08, 0.16, 0.18) });
  };
  const newPage = (dates: string[]) => {
    page = document.addPage([width, height]);
    y = height - margin;
    write(`Filial ${input.branchCode} - ${input.branchName}`, margin, y, 13, true);
    y -= 19;
    write(`Escala 5x2 | ${input.startDate} a ${input.endDate} | Versão ${workspace.revision} | ${workspace.status === "PUBLISHED" ? "PUBLICADA" : "RASCUNHO"}`, margin, y, 10);
    y -= 17;
    write(`F = Folga | SH = Trabalho sem horário fixo | A = Ausência | SV = Fora do vínculo | ? = Não definido | ${input.employees.length - employees.length} fora da geração`, margin, y, 9);
    y -= 23;
    write("Matrícula / colaborador", margin, y, 10, true, labelWidth - 8);
    dates.forEach((date, index) => { write(`${date.slice(8)}/${date.slice(5, 7)} ${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][index]}`, margin + labelWidth + index * cellWidth, y, 10, true, cellWidth - 4); });
    y -= 18;
  };
  const groupText = (employee: EscalaEmployee) => `${employee.sector} / ${employee.role}`;
  for (let start = 0; start < allDates.length; start += 7) {
    const dates = allDates.slice(start, start + 7);
    newPage(dates);
    let lastGroup = "";
    for (const employee of employees) {
      const group = groupText(employee);
      if (y < 65) { newPage(dates); lastGroup = ""; }
      if (group !== lastGroup) {
        if (y < 85) newPage(dates);
        page.drawRectangle({ x: margin, y: y - 4, width: width - 2 * margin, height: 18, color: rgb(0.9, 0.95, 0.94) });
        write(group, margin + 4, y, 10, true);
        y -= 22;
        lastGroup = group;
      }
      write(`${employee.registration} - ${employee.name}`, margin, y, 10, false, labelWidth - 8);
      dates.forEach((date, index) => {
        const item = assignments.get(`${employee.id}\0${date}`);
        const value = date < employee.activeFrom || (employee.activeUntil && date > employee.activeUntil) ? "SV" : !item ? "?" : item.kind === "OFF" ? "F" : item.kind === "ABSENCE" ? "A" : item.kind === "DUTY" ? "SH" : shiftCodes.get(item.shiftId ?? "") ?? "?";
        write(value, margin + labelWidth + index * cellWidth, y, 9, false, cellWidth - 5);
      });
      y -= 19;
    }
  }
  newPage([]);
  write("Resumo de carga e turnos", margin, y, 12, true); y -= 22;
  let summaryGroup = "";
  for (const employee of employees) {
    if (y < 60) { newPage([]); summaryGroup = ""; }
    const group = groupText(employee);
    if (group !== summaryGroup) {
      if (y < 85) { newPage([]); summaryGroup = ""; }
      write(group, margin, y, 10, true); y -= 20;
      summaryGroup = group;
    }
    const summary = summaries.get(employee.id);
    const targets = [...new Set(weeklyTargets(input, employee).map((week) => week.hours))].join("/");
    write(employee.scheduleMode === "UNTIMED"
      ? `${employee.registration} - ${employee.name} | Sem horário fixo | ${summary?.workDays ?? 0} dias de trabalho | ${summary?.offDays ?? 0} folgas | Horas não apuradas`
      : `${employee.registration} - ${employee.name} | Referência ${employee.weeklyHours}h | Vigente ${targets}h/semana | Previsto ${duration(summary?.workedMinutes ?? 0)} | ${summary?.workDays ?? 0} dias`, margin, y, 10); y -= 18;
  }
  for (const shift of input.shifts) {
    if (y < 60) newPage([]);
    write(`${shiftCodes.get(shift.id)} - ${shift.name}: ${shift.segments.map((segment) => `${duration(segment.start)}-${duration(segment.end)} ${segment.kind === "WORK" ? "trabalho" : segment.kind === "BREAK" ? "intervalo" : "pausa remunerada"}`).join(" / ")}`, margin, y, 9); y -= 18;
  }
  if (y < 105) newPage([]);
  write(`Conferência: ${workspace.validation.issues.filter((issue) => issue.severity === "ERROR").length} impedimentos e ${workspace.validation.issues.filter((issue) => issue.severity === "PENDING").length} pendências. Consulte a versão no sistema.`, margin, y - 10, 10, true);
  const limited = workspace.validation.issues.some((issue) => issue.code === "HISTORY_UNVERIFIED");
  if (limited) write("Continuidade real anterior não conferida. A proposta usa o planejamento informado; não comprova registros de ponto.", margin, y - 30, 9, true);
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Filial ${safePdfText(input.branchCode, font)} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Escala - Filial ${input.branchCode} - ${input.startDate}`);
  return document.save();
}
