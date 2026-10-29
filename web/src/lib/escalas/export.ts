import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import type { EscalaWorkspace } from "./types";
import { effectiveWeeklyMinutes, weeklyTargets } from "./labor-rules";
import { buildEscalaDiagnostics } from "./diagnostics";
import { consolidateCoverageGaps, type SectorCoverageGap } from "./coverage-presence";
import { buildEscalaPresentation, escalaDateLabel, escalaDuration, type EscalaExportMode } from "./presentation";

function xml(value: unknown) {
  const text = [...String(value ?? "")].filter((character) => {
    const point = character.codePointAt(0) ?? 0;
    return [9, 10, 13].includes(point) || (point >= 32 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || point >= 0x10000;
  }).join("");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function column(index: number) {
  let name = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

function issueMessageParts(messages: string[]): string[] {
  const parts: string[] = [];
  let part = "";
  for (const message of messages) {
    if (part && part.length + message.length + 1 > 30000) { parts.push(part); part = ""; }
    for (let start = 0; start < message.length; start += 30000) {
      const text = message.slice(start, start + 30000);
      if (start + 30000 < message.length) parts.push(text);
      else part = part ? `${part}\n${text}` : text;
    }
  }
  if (part) parts.push(part);
  return parts.length ? parts : [""];
}

const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><color rgb="FF142E2A"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F38"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCF0E4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E9EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="hair"><color rgb="FFD8E4DF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function sheet(rows: (string | number)[][], widths: number[], grid = false, frozenColumns = grid ? 5 : 0) {
  const header = grid ? 4 : 1, last = `${column(widths.length - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ${frozenColumns ? `xSplit="${frozenColumns}" ySplit="${header}" topLeftCell="${column(frozenColumns)}${header + 1}" activePane="bottomRight"` : 'ySplit="1" topLeftCell="A2" activePane="bottomLeft"'} state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="28"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((row, index) => {
    const title = grid && index < 3;
    const lines = title ? 1 : Math.max(1, ...row.map((value, cell) => String(value).split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, widths[cell] - 2))), 0)));
    const height = index === header - 1 ? 36 : Math.min(409, Math.max(28, lines * 14 + 8));
    return `<row r="${index + 1}" ht="${height}" customHeight="1">${row.map((value, cell) => {
      const style = index === header - 1 || title ? 1 : grid && cell >= frozenColumns && value === "F" ? 4 : grid && cell >= frozenColumns && value === "NP" ? 5 : grid && cell >= frozenColumns && ["X", "FV", "AF", "ENC"].includes(String(value)) ? 6 : index % 2 ? 2 : 3;
      return typeof value === "number" ? `<c r="${column(cell)}${index + 1}" s="${style}"><v>${value}</v></c>` : `<c r="${column(cell)}${index + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`;
  }).join("")}</sheetData><autoFilter ref="A${header}:${last}"/>${grid ? `<mergeCells count="3">${[1, 2, 3].map((row) => `<mergeCell ref="A${row}:${column(widths.length - 1)}${row}"/>`).join("")}</mergeCells>` : ""}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LPerfectUtilitares&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter></worksheet>`;
}

export function exportEscalaXlsx(workspace: EscalaWorkspace, mode: EscalaExportMode = "both"): Uint8Array {
  const model = buildEscalaPresentation(workspace);
  const diagnostics = buildEscalaDiagnostics(workspace.input, workspace.validation.issues);
  const main: (string | number)[][] = [[model.branch], [`Escala 5x2 | ${model.period} | Versão ${workspace.revision} | ${model.state}`], [model.legend],
    ["Setor", "Matrícula", "Colaborador", "Cargo", "Horário proposto", ...model.dates.map(escalaDateLabel)],
    ...model.people.map(({ employee, cells, proposedSchedule }) => [employee.sector, employee.registration, employee.name, employee.role, proposedSchedule, ...cells.map((cell) => cell.code)])];
  const review: (string | number)[][] = [["Situação", "Local", "Ocorrências", "Datas", "Como conferir"]];
  const employeesById = new Map(workspace.input.employees.map((employee) => [employee.id, employee]));
  for (const notice of diagnostics.notices) {
    const label = notice.severity === "ERROR" ? "Exige correção" : notice.severity === "PENDING" ? "Ponto para revisar" : "Informação";
    const affected = notice.employeeIds.map((id) => { const person = employeesById.get(id); return person ? person.sector + " / " + person.registration + " - " + person.name : "Colaborador não encontrado"; }).join("\n") || "Proposta";
    issueMessageParts([notice.message]).forEach((part, index) => { review.push([index ? label + " (continuação)" : label, affected, index ? 0 : notice.count, notice.dates.join(", "), part]); });
  }
  // The operational conference is shared with the PDF; boundary evidence remains accessible, not discarded.
  for (const issue of model.issues.filter((issue) => issue.context.includes("verificação técnica entre períodos"))) {
    issueMessageParts(issue.messages).forEach((part, index) => { review.push([index ? issue.label + " (continuação técnica)" : issue.label + " — entre períodos", issue.context, index ? 0 : issue.count, issue.dates.sort().join(", "), part]); });
  }
  if (review.length === 1) review.push(["Conferido", "Proposta", 0, "", "Sem ocorrências registradas nesta versão. A simulação não certifica a execução da jornada."]);
  const turns: (string | number)[][] = [["Código", "Turno", "Colaboradores", "Setores", "Referência importada", "Horário original", "Sábado original", "Entrada", "Intervalo", "Saída", "Jornada diária", "Horário proposto", "Alterações em relação ao original"]];
  for (const shift of model.shifts) turns.push([shift.code, shift.name, shift.employeeCount, shift.sectors.join(" / "), shift.sources.map((source) => `${source.code} - ${source.description}`).join("\n") || "Não informada", shift.sources.map((source) => source.weekday).join("\n") || "Não informado", shift.sources.map((source) => source.saturday).join("\n") || "Não informado", shift.entry, shift.interval, shift.exit, shift.daily, shift.schedule, shift.sources.map((source) => source.changes).join("\n") || "Sem referência original para comparação"]);
  const details: (string | number)[][] = [["Setor", "Matrícula", "Colaborador", "Carga semanal de referência", "Carga proposta nesta semana", "Dias de trabalho", "Folgas", "Horas planejadas no mês", "Limites da conferência"]];
  const visible = new Set(model.dates), shifts = new Map(workspace.input.shifts.map((shift) => [shift.id, shift]));
  for (const { employee } of model.people) {
    const untimed = employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING";
    const assignments = workspace.input.assignments.filter((assignment) => employee.planningEnabled !== false && assignment.employeeId === employee.id && visible.has(assignment.date) && assignment.date >= employee.activeFrom && (!employee.activeUntil || assignment.date <= employee.activeUntil));
    const hours = [...new Set(weeklyTargets(workspace.input, employee).map((week) => effectiveWeeklyMinutes(employee, week.start)))].map(minutes => minutes % 60 === 0 ? minutes / 60 : escalaDuration(minutes));
    const minutes = assignments.reduce((sum, assignment) => sum + (assignment.kind === "WORK" ? shifts.get(assignment.shiftId ?? "")?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0) ?? 0 : 0), 0);
    details.push([employee.sector, employee.registration, employee.name, untimed ? "Não apurada" : employee.weeklyHours, untimed ? "Não apurada" : hours.length === 1 ? hours[0] : hours.join(" / "), assignments.filter((assignment) => assignment.kind === "WORK" || assignment.kind === "DUTY").length, assignments.filter((assignment) => assignment.kind === "OFF").length, untimed ? "Não apuradas" : escalaDuration(minutes), employee.planningEnabled === false ? employee.planningExclusionReason || "Não incluído" : untimed ? "Presença diária sem apuração de horas ou cobertura horária. Não certifica enquadramento jurídico." : employee.simulationDailyMinutes !== undefined ? "Referência curta preservada em simulação; carga contratual individual não confirmada. Confira a referência original antes da aplicação." : "Proposta de jornada; confira ocorrências e horários originais."]);
  }
  const gaps: (string | number)[][] = [["Data", "Setor", "Início", "Fim", "Presentes no setor", "Referência do setor", "Base", "Situação", "Funções a revisar", "Ajuste sugerido"],
    ...diagnostics.coverageGroups.map((gap) => [gap.date, gap.sector, escalaDuration(gap.start), escalaDuration(gap.end), gap.present, gap.minimum,
      gap.estimated ? "Estimada" : "Mínimo informado", coverageSituation(gap), coverageRoles(gap), gap.suggestion])];
  const hours: (string | number)[][] = [["Data", "Setor", "Matrícula", "Colaborador", "Cargo", "Situação", "Horário proposto", "Intervalo", "Horas do dia", "Motivo ou orientação"],
    ...model.people.flatMap(({ employee, cells }) => cells.map((cell) => [cell.date, employee.sector, employee.registration, employee.name, employee.role, cell.code,
      cell.shiftId ? cell.schedule : "Não se aplica", cell.interval, cell.daily, cell.description]))];
  const excluded: (string | number)[][] = [["Situação", "Setor", "Matrícula", "Colaborador", "Cargo", "Motivo da não inclusão", "Como corrigir"],
    ...model.excluded.map(({ employee, code, reason, guidance }) => [code, employee.sector, employee.registration, employee.name, employee.role, reason, guidance])];
  const sheets = [
    ...(mode !== "hours" ? [{ name: "Escala", frozenColumns: 5, rows: main, widths: [24, 12, 42, 26, 46, ...model.dates.map(() => 6)], grid: true }] : []),
    ...(mode !== "rest" ? [{ name: "Horarios", frozenColumns: 4, rows: hours, widths: [16, 24, 12, 42, 26, 12, 42, 32, 18, 80], grid: false }] : []),
    { name: "Conferencia", frozenColumns: 2, rows: review, widths: [18, 38, 14, 40, 110], grid: false },
    { name: "Turnos", frozenColumns: 2, rows: turns, widths: [10, 30, 16, 32, 40, 38, 38, 12, 28, 12, 16, 38, 80], grid: false },
    { name: "Jornadas", frozenColumns: 3, rows: details, widths: [24, 14, 42, 22, 26, 18, 14, 24, 80], grid: false },
    { name: "Desfalques", frozenColumns: 3, rows: gaps, widths: [16, 26, 12, 12, 20, 22, 24, 42, 65, 100], grid: false },
    { name: "Excluidos", frozenColumns: 4, rows: excluded, widths: [12, 24, 12, 42, 26, 64, 80], grid: false },
  ];
  const printDefinitions = sheets.map((entry, index) => {
    const name = `'${entry.name}'`;
    const rows = `${name}!$1:$${entry.grid ? 4 : 1}`;
    const columns = `${name}!$A:$${column(entry.frozenColumns - 1)}`;
    const area = `${name}!$A$1:$${column(entry.widths.length - 1)}$${entry.rows.length}`;
    return '<definedName name="_xlnm.Print_Titles" localSheetId="' + index + '">' + rows + "," + columns + '</definedName>'
      + '<definedName name="_xlnm.Print_Area" localSheetId="' + index + '">' + area + '</definedName>';
  }).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((entry, index) => `<sheet name="${entry.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><definedNames>${printDefinitions}</definedNames></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(XLSX_STYLES),
  };
  for (const [index, entry] of sheets.entries()) files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet(entry.rows, entry.widths, entry.grid, entry.frozenColumns));
  return zipSync(files, { level: 6 });
}

function coverageSituation(gap: SectorCoverageGap): string {
  return gap.kind === "no-service" ? "Nenhuma presença horária apurada" : gap.estimated ? "Abaixo da estimativa automática" : "Mínimo informado não atendido";
}
function coverageRoles(gap: SectorCoverageGap): string {
  return gap.roles.length ? gap.roles.map((role) => role.role + ": " + role.present + " presente(s), referência " + role.minimum + (role.estimated ? " estimada" : " informada")).join("; ") : "Referência do setor, sem função específica";
}

function safePdfText(text: string, font: PDFFont) {
  return [...text.replace(/[\r\n\t]+/g, " ")].map((character) => {
    try { font.encodeText(character); return character; } catch { return "?"; }
  }).join("");
}

/** Wrap, including long tokens, rather than discarding names or schedule details. */
function wrapText(text: string, width: number, font: PDFFont, size: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const word of safePdfText(text, font).split(/\s+/).filter(Boolean)) {
    if (current && font.widthOfTextAtSize(`${current} ${word}`, size) > width) { result.push(current); current = ""; }
    let remainder = word;
    while (font.widthOfTextAtSize(remainder, size) > width) {
      let count = 1;
      while (count < remainder.length && font.widthOfTextAtSize(remainder.slice(0, count + 1), size) <= width) count++;
      result.push(remainder.slice(0, count)); remainder = remainder.slice(count);
    }
    current = current ? `${current} ${remainder}` : remainder;
  }
  if (current || !result.length) result.push(current);
  return result;
}

/** Group contiguous civil dates without hiding a missing day or crossing an unknown range. */
function compactDates(dates: string[]): string {
  const groups: string[][] = [];
  for (const date of [...new Set(dates)].sort()) {
    const last = groups.at(-1), previous = last?.at(-1);
    if (last && previous && Date.parse(date + "T00:00:00Z") - Date.parse(previous + "T00:00:00Z") === 86400000) last.push(date);
    else groups.push([date]);
  }
  return groups.map((group) => group.length > 1 ? escalaDateLabel(group[0]).split(" ")[0] + "–" + escalaDateLabel(group.at(-1) as string).split(" ")[0] : escalaDateLabel(group[0]).split(" ")[0]).join(", ");
}

export async function exportEscalaPdf(workspace: EscalaWorkspace, mode: EscalaExportMode = "both"): Promise<Uint8Array> {
  const model = buildEscalaPresentation(workspace), document = await PDFDocument.create();
  const diagnostics = buildEscalaDiagnostics(workspace.input, workspace.validation.issues);
  const font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = model.dates.length > 21 ? 1191 : 842, height = model.dates.length > 21 ? 842 : 595;
  const margin = 26, labelWidth = 300, cellWidth = (width - 2 * margin - labelWidth) / Math.max(1, model.dates.length);
  let page!: PDFPage;
  let y = 0;
  const write = (text: string, x: number, baseline: number, size = 9, strong = false) => page.drawText(safePdfText(text, strong ? bold : font), { x, y: baseline, size, font: strong ? bold : font, color: rgb(0.08, 0.16, 0.18) });
  const newPage = (grid: boolean) => {
    page = document.addPage([width, height]); y = height - margin;
    for (const line of wrapText(model.branch, width - 2 * margin, bold, 13)) { write(line, margin, y, 13, true); y -= 18; }
    write(`Escala 5x2 | ${model.period} | Versão ${workspace.revision} | ${model.state}`, margin, y, 10); y -= 17;
    if (grid) for (const line of wrapText(model.legend, width - 2 * margin, font, 8)) { write(line, margin, y, 8); y -= 12; }
    y -= 8;
    if (grid) {
      write("Matrícula / colaborador", margin, y, 9, true);
      model.dates.forEach((date, index) => {
        const x = margin + labelWidth + index * cellWidth;
        write(date.slice(8), x + 2, y, 8, true);
        write(escalaDateLabel(date).split(" ")[1], x + 2, y - 12, 7);
      });
      y -= 30;
    }
  };
  const paragraph = (text: string, size = 8.5, strong = false) => {
    for (const line of wrapText(text, width - 2 * margin, strong ? bold : font, size)) {
      if (y < 50) newPage(false);
      write(line, margin, y, size, strong); y -= size + 4;
    }
  };
  const section = (title: string) => { if (y < 85) newPage(false); y -= 8; paragraph(title, 11, true); };
  newPage(mode !== "hours");
  if (mode !== "hours") paragraph("Escala de folgas", 11, true);
  else paragraph(model.legend, 8);
  let sector = "";
  for (const { employee, cells, proposedSchedule, proposedVariants } of mode === "hours" ? [] : model.people) {
    const names = wrapText(`${employee.registration} - ${employee.name}`, labelWidth - 12, font, 9);
    const roles = wrapText(employee.role, labelWidth - 12, font, 7.5);
    const proposed = wrapText(proposedVariants.length > 1 ? "Horário variável: " + proposedVariants.map((entry) => entry.code).join(", ") + " (ver horários)" : "Horário proposto: " + proposedSchedule, labelWidth - 12, font, 7);
    const rowHeight = Math.max(30, names.length * 12 + roles.length * 10 + proposed.length * 9 + 4);
    const sectorLines = wrapText(employee.sector || "Setor não informado", width - 2 * margin - 8, bold, 9);
    const sectorHeight = sectorLines.length * 12 + 8;
    if (y - rowHeight - (sector !== employee.sector ? sectorHeight : 0) < 45) { newPage(true); sector = ""; }
    if (sector !== employee.sector || !sector) {
      page.drawRectangle({ x: margin, y: y - sectorHeight + 13, width: width - 2 * margin, height: sectorHeight, color: rgb(0.9, 0.95, 0.94) });
      for (const line of sectorLines) { write(line, margin + 4, y, 9, true); y -= 12; }
      y -= 8; sector = employee.sector;
    }
    names.forEach((line, index) => { write(line, margin, y - index * 12); });
    roles.forEach((line, index) => { write(line, margin, y - names.length * 12 - index * 10, 7.5); });
    proposed.forEach((line, index) => { write(line, margin, y - names.length * 12 - roles.length * 10 - index * 9, 7); });
    cells.forEach((cell, index) => {
      const x = margin + labelWidth + index * cellWidth;
      if (cell.code === "F") page.drawRectangle({ x, y: y - rowHeight + 12, width: cellWidth - 1, height: rowHeight - 2, color: rgb(0.87, 0.94, 0.89) });
      else if (cell.code === "NP") page.drawRectangle({ x, y: y - rowHeight + 12, width: cellWidth - 1, height: rowHeight - 2, color: rgb(1, 0.95, 0.82) });
      write(cell.code, x + 2, y, 7.5, cell.code === "F");
    });
    y -= rowHeight;
  }
  if (!model.people.length) paragraph("Nenhum colaborador incluído nesta proposta.");
  if (mode !== "rest") {
    if (mode === "both") newPage(false);
    section("Escala de horários");
    paragraph("Horários efetivos por colaborador. Dias com o mesmo horário são agrupados; horários diferentes permanecem separados. Intervalos não contam como presença.");
    for (const { employee, cells } of model.people) {
      if (y < 95) newPage(false);
      paragraph(employee.sector + " | " + employee.registration + " - " + employee.name + " | " + employee.role, 9, true);
      const groups = new Map<string, { cell: typeof cells[number]; dates: string[] }>();
      for (const cell of cells) {
        const key = JSON.stringify([cell.code, cell.schedule, cell.interval, cell.daily]);
        const group = groups.get(key) ?? { cell, dates: [] };
        group.dates.push(cell.date); groups.set(key, group);
      }
      for (const { cell, dates } of groups.values()) {
        paragraph(compactDates(dates) + " | " + cell.code + " | " + (cell.shiftId ? cell.schedule + " | Intervalo " + cell.interval + " | " + cell.daily + " de jornada" : cell.description));
      }
      y -= 4;
    }
  }
  if (model.excluded.length) {
    section("Colaboradores não incluídos — relação separada");
    for (const { employee, code, reason, guidance } of model.excluded) {
      paragraph(code + " | " + employee.sector + " | " + employee.registration + " - " + employee.name + " | " + employee.role, 9, true);
      paragraph("Motivo: " + reason); paragraph(guidance);
    }
  }
  if (model.shifts.length) section("Turnos utilizados na escala");
  for (const shift of model.shifts) {
    if (y < 105) newPage(false);
    paragraph(`${shift.code} | Entrada ${shift.entry} | Intervalo ${shift.interval} | Saída ${shift.exit} | Jornada ${shift.daily}`, 9, true);
    paragraph(`${shift.employeeCount} colaborador(es) | Setores: ${shift.sectors.join(" / ")}`);
    paragraph(`Horário proposto: ${shift.schedule}`);
    if (!shift.sources.length) paragraph("Referência importada não informada. A proposta não substitui a definição contratual.");
    for (const source of shift.sources) {
      paragraph(`Original importado ${source.code} - ${source.description}: ${source.weekday} | Sábado original: ${source.saturday}`);
      paragraph(source.changes);
    }
    y -= 5;
  }
  if (diagnostics.coverageGroups.length) {
    section("Desfalques de cobertura");
    paragraph("Presentes considera somente trabalho efetivo na faixa, sem intervalos. A referência estimada não é um mínimo operacional comprovado. A função ausente não é substituída automaticamente por outra.");
    const grouped = consolidateCoverageGaps(diagnostics.coverageGroups);
    const score = (gap: typeof grouped[number]) => Math.max(0, gap.minimum - gap.present, ...gap.roles.map((role) => role.minimum - role.present)) * (gap.end - gap.start) * gap.dates.length;
    const ranked = [...grouped].sort((left, right) => score(right) - score(left) || left.sector.localeCompare(right.sector, "pt-BR") || left.start - right.start);
    const required = ranked.filter((gap) => !gap.estimated), estimated = ranked.filter((gap) => gap.estimated);
    const priorities = [...required, ...estimated.slice(0, 24)];
    if (estimated.length > 24) paragraph("Prioridades: 24 de " + estimated.length + " grupos estimados, por impacto na presença. Todos os " + required.length + " grupos de mínimo informado estão incluídos. As " + diagnostics.coverageGroups.length + " faixas setoriais por dia estão integralmente na aba Desfalques do Excel.");
    const widths = [0.19, 0.15, 0.11, 0.07, 0.08, 0.23, 0.17].map((ratio) => (width - 2 * margin) * ratio);
    const headings = ["Setor", "Dia(s)", "Horário", "Presentes", "Referência", "Funções a revisar", "Situação / base"];
    const tableHeader = () => {
      if (y < 85) newPage(false);
      let x = margin;
      headings.forEach((heading, index) => { write(heading, x + 3, y, 8, true); x += widths[index]; });
      y -= 17;
    };
    tableHeader();
    for (const gap of priorities) {
      const cells = [gap.sector, compactDates(gap.dates), escalaDuration(gap.start) + "-" + escalaDuration(gap.end), String(gap.present), String(gap.minimum), coverageRoles(gap), coverageSituation(gap) + (gap.estimated ? " — Estimada" : " — Mínimo informado")];
      const lines = cells.map((cell, index) => wrapText(cell, widths[index] - 7, font, 8));
      const rowHeight = Math.max(...lines.map((values) => values.length)) * 11 + 8;
      if (y - rowHeight < 45) { newPage(false); paragraph("Desfalques de cobertura (continuação)", 11, true); tableHeader(); }
      page.drawRectangle({ x: margin, y: y - rowHeight + 12, width: width - 2 * margin, height: rowHeight, color: rgb(0.95, 0.97, 0.96) });
      let x = margin;
      lines.forEach((values, index) => { values.forEach((line, position) => { write(line, x + 3, y - position * 11, 8, index === 5); }); x += widths[index]; });
      y -= rowHeight;
    }
    paragraph("Ajuste: reveja entradas, saídas e intervalos no setor e nas funções indicadas. Redistribuir horários pode ampliar a presença na faixa. Mudanças de folga exigem nova geração para conferir jornada, afastamentos e bloqueios. Compare estimativas com a necessidade real antes de tratá-las como falta de pessoal.");
  }
  section("Conferência da proposta");
  if (!diagnostics.notices.length && !diagnostics.coverage.length) paragraph("Sem ocorrências registradas no mês exibido.");
  const employees = new Map(workspace.input.employees.map(employee => [employee.id, employee]));
  for (const notice of diagnostics.notices) {
    const severity = notice.severity === "ERROR" ? "Exige correção" : notice.severity === "PENDING" ? "Ponto para revisar" : "Informação";
    const affected = notice.global ? (notice.employeeIds.length ? ` | ${notice.employeeIds.length} colaborador(es)` : "")
      : notice.employeeIds.map(id => { const person = employees.get(id); return person ? ` | ${person.sector} / ${person.registration} - ${person.name}` : ""; }).join("");
    paragraph(`${severity}${notice.label === severity || notice.label === "Atenção" ? "" : ` | ${notice.label}`}${affected}${!notice.global && notice.count > 1 ? ` | ${notice.count} ocorrências` : ""}`, 9, true);
    if (notice.dates.length) paragraph(`Dia(s): ${notice.dates.map(date => `${date.slice(8)}/${date.slice(5, 7)}`).join(", ")}`);
    paragraph(notice.message);
  }
  if (diagnostics.technicalIssueCount) paragraph(`${diagnostics.technicalIssueCount}${diagnostics.technicalIssueCount === 1 ? " verificação entre períodos está detalhada" : " verificações entre períodos estão detalhadas"} na aba Conferencia do Excel.`);
  paragraph("Proposta de apoio: não certifica conformidade legal nem registros de ponto.", 8);
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Filial ${safePdfText(workspace.input.branchCode, font)} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Escala - Filial ${workspace.input.branchCode} - ${model.dates[0] ?? workspace.input.startDate}`);
  return document.save();
}
