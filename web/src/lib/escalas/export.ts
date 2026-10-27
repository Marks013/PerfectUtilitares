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
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color rgb="FF142E2A"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F38"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="hair"><color rgb="FFD8E4DF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function sheet(rows: (string | number)[][], widths: number[]) {
  const last = `${column(rows[0].length - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((row, index) => {
    const lines = Math.max(1, ...row.map((value, cell) => String(value).split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, widths[cell] - 3))), 0)));
    const height = index === 0 ? 34 : Math.min(409, Math.max(30, lines * 15 + 8));
    const style = index === 0 ? 1 : index % 2 ? 2 : 3;
    return `<row r="${index + 1}" ht="${height}" customHeight="1">${row.map((value, cell) => typeof value === "number"
      ? `<c r="${column(cell)}${index + 1}" s="${style}"><v>${value}</v></c>`
      : `<c r="${column(cell)}${index + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`;
  }).join("")}</sheetData><autoFilter ref="A1:${last}"/><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LPerfectUtilitares&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter></worksheet>`;
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
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Escala" sheetId="1" r:id="rId1"/><sheet name="Conferencia" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">\'Escala\'!$1:$1</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">\'Conferencia\'!$1:$1</definedName></definedNames></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/styles.xml": strToU8(XLSX_STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheet(rows, [26, 24, 26, 14, 42, 13, 28, 38, 20, 22, 11, 14, 22, 34])),
    "xl/worksheets/sheet2.xml": strToU8(sheet(issues, [25, 32, 46, 14, 110])),
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
  const includedIds = new Set(employees.map((employee) => employee.id));
  const usedShiftIds = new Set(input.assignments.filter((item) => item.kind === "WORK" && includedIds.has(item.employeeId)).map((item) => item.shiftId));
  const usedShifts = input.shifts.filter((shift) => usedShiftIds.has(shift.id));
  const shiftCodes = new Map(usedShifts.map((shift, index) => [shift.id, `T${String(index + 1).padStart(2, "0")}`]));
  const width = 842, height = 595, margin = 26, labelWidth = 270, cellWidth = (width - 2 * margin - labelWidth) / 7;
  let page!: PDFPage;
  let y = 0;
  const write = (text: string, x: number, lineY: number, size = 10, strong = false, maxWidth = width - 2 * margin) => {
    const selected = strong ? bold : font;
    page.drawText(fitText(text, maxWidth, selected, size), { x, y: lineY, size, font: selected, color: rgb(0.08, 0.16, 0.18) });
  };
  const newPage = (dates: string[], section = "Resumo de carga e turnos") => {
    page = document.addPage([width, height]);
    y = height - margin;
    write(`Filial ${input.branchCode} - ${input.branchName}`, margin, y, 13, true);
    y -= 19;
    write(`Escala 5x2 | ${input.startDate} a ${input.endDate} | Versão ${workspace.revision} | ${workspace.status === "PUBLISHED" ? "PUBLICADA" : "RASCUNHO"}`, margin, y, 10);
    y -= 17;
    write(`F = Folga | SH = Trabalho sem horário fixo | A = Ausência | SV = Fora do vínculo | ? = Não definido | ${input.employees.length - employees.length} fora da geração`, margin, y, 9);
    y -= 23;
    if (dates.length) {
      write("Matrícula / colaborador", margin, y, 10, true, labelWidth - 8);
      dates.forEach((date, index) => { write(`${date.slice(8)}/${date.slice(5, 7)} ${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][index]}`, margin + labelWidth + index * cellWidth, y, 10, true, cellWidth - 4); });
      y -= 18;
    } else {
      write(section, margin, y, 12, true); y -= 24;
      if (section === "Resumo de carga e turnos") {
        ["Matrícula / colaborador", "Referência", "Vigente", "Horas previstas", "Trabalho", "Folgas"].forEach((label, index) => { write(label, margin + [0, 330, 410, 490, 600, 690][index], y, 10, true, index ? 95 : 320); });
        y -= 20;
      }
    }
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
    const values = [`${employee.registration} - ${employee.name}`, employee.scheduleMode === "UNTIMED" ? "Sem horário" : `${employee.weeklyHours}h`, employee.scheduleMode === "UNTIMED" ? "Não apurada" : `${targets}h`, employee.scheduleMode === "UNTIMED" ? "Não apuradas" : duration(summary?.workedMinutes ?? 0), String(summary?.workDays ?? 0), String(summary?.offDays ?? 0)];
    values.forEach((value, index) => { write(value, margin + [0, 330, 410, 490, 600, 690][index], y, 10, false, index ? 95 : 320); }); y -= 19;
  }
  if (usedShifts.length) {
    if (y < 100) newPage([], "Turnos utilizados na escala");
    else { write("Turnos utilizados na escala", margin, y, 12, true); y -= 22; }
  }
  for (const shift of usedShifts) {
    if (y < 60) newPage([], "Turnos utilizados na escala");
    write(`${shiftCodes.get(shift.id)} - ${shift.name}: ${shift.segments.map((segment) => `${duration(segment.start)}-${duration(segment.end)} ${segment.kind === "WORK" ? "trabalho" : segment.kind === "BREAK" ? "intervalo" : "pausa remunerada"}`).join(" / ")}`, margin, y, 9); y -= 18;
  }
  if (y < 105) newPage([], "Conferência da proposta");
  write(`Conferência: ${workspace.validation.issues.filter((issue) => issue.severity === "ERROR").length} impedimentos e ${workspace.validation.issues.filter((issue) => issue.severity === "PENDING").length} pendências. Consulte a versão no sistema.`, margin, y - 10, 10, true);
  const limited = workspace.validation.issues.some((issue) => issue.code === "HISTORY_UNVERIFIED");
  if (limited) write("Continuidade real anterior não conferida. A proposta usa o planejamento informado; não comprova registros de ponto.", margin, y - 30, 9, true);
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Filial ${safePdfText(input.branchCode, font)} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Escala - Filial ${input.branchCode} - ${input.startDate}`);
  return document.save();
}
