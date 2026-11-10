import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import type { EscalaInput, EscalaWorkspace } from "./types";
import { compareSectors, sortScheduleEntries } from "./order";
import { buildCoveragePresence, sectorCoverageGaps, sectorPresenceGaps } from "./coverage-presence";
import { summarizeCoverageGaps, type SectorCoverageSummary } from "./coverage-summary";
import { buildEscalaPresentation, escalaDateLabel, escalaDuration, type EscalaExportMode } from "./presentation";
import { mixedWeeklyApplication } from "./mixed-week-report";
import { storeClosingLabel } from "./store-hours";
import { visibleDates, weekStart } from "./dates";
import { usesMixed42Week } from "./labor-rules";

function reportPeriod(value: string): string {
  return value.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");
}

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

const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F7FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4E9F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF9E7E7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EEF4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD1D9E3"/></left><right style="thin"><color rgb="FFD1D9E3"/></right><top style="thin"><color rgb="FFD1D9E3"/></top><bottom style="thin"><color rgb="FFD1D9E3"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Quiet metadata and sector bands leave the strongest contrast for the actual column headings. */
const XLSX_REPORT_STYLES = XLSX_STYLES.replace('<fonts count="2">', '<fonts count="3">')
  .replace('</fonts>', '<font><b/><sz val="10"/><color rgb="FF243B53"/><name val="Calibri"/><family val="2"/></font></fonts>')
  .replace('<cellXfs count="8">', '<cellXfs count="11">')
  .replace('<xf numFmtId="0" fontId="0" fillId="4"', '<xf numFmtId="0" fontId="2" fillId="4"')
  .replace('</cellXfs>', '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>');

/** Conservative Calibri-width estimate: wide glyphs must not hide wrapped rows. */
function spreadsheetLines(text: string, width: number): number {
  return text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil([...line].reduce((units, character) =>
    units + (/\s/u.test(character) ? 0.75 : /[MWmw@%]/u.test(character) ? 2 : /[A-ZÀ-Þ]/u.test(character) ? 1.5 : /[^\u0020-\u00ff]/u.test(character) ? 2 : 1.2), 0) / Math.max(1, width - 1))), 0);
}

function sheet(rows: (string | number)[][], widths: number[], grid = false, frozenColumns = grid ? 5 : 0, sectors: number[] = []) {
  const header = 4, last = `${column(widths.length - 1)}${rows.length}`;
  const activeCell = `${column(frozenColumns)}${header + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="${grid ? 75 : 90}" zoomScaleNormal="100"><pane ${frozenColumns ? `xSplit="${frozenColumns}" ySplit="${header}" topLeftCell="${column(frozenColumns)}${header + 1}" activePane="bottomRight"` : 'ySplit="1" topLeftCell="A2" activePane="bottomLeft"'} state="frozen"/><selection pane="${frozenColumns ? "bottomRight" : "bottomLeft"}" activeCell="${activeCell}" sqref="${activeCell}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((row, index) => {
    const title = index < 3 || sectors.includes(index);
    const available = title ? widths.reduce((sum, width) => sum + width, 0) - 2 : 0;
    const lines = Math.max(1, ...row.map((value, cell) => spreadsheetLines(String(value), title ? available : widths[cell])));
    const height = index < 2 ? Math.max(20, lines * 13 + 4) : index === 2 ? Math.max(22, lines * 13 + 4) : index === header - 1 ? Math.max(34, lines * 13 + 6) : sectors.includes(index) ? Math.max(22, lines * 13 + 4) : Math.min(409, Math.max(22, lines * 13 + 6));
    return `<row r="${index + 1}" ht="${height}" customHeight="1">${row.map((value, cell) => {
      const style = sectors.includes(index) ? 9 : index < 3 ? index === 0 ? 8 : 0 : index === header - 1 ? grid && cell >= frozenColumns ? 10 : 1 : grid && cell >= frozenColumns && value === "F" ? 4 : grid && cell >= frozenColumns && value === "NP" ? 5 : grid && cell >= frozenColumns && ["X", "FV", "AF", "ENC"].includes(String(value)) ? 6 : grid && cell >= frozenColumns ? 7 : index % 2 ? 2 : 3;
      const text = `<t xml:space="preserve">${xml(value)}</t>`;
      return typeof value === "number" ? `<c r="${column(cell)}${index + 1}" s="${style}"><v>${value}</v></c>` : `<c r="${column(cell)}${index + 1}" s="${style}" t="inlineStr"><is>${text}</is></c>`;
    }).join("")}</row>`;
  }).join("")}</sheetData><autoFilter ref="A${header}:${last}"/>${`<mergeCells count="${3 + sectors.length}">${[1, 2, 3, ...sectors.map(index => index + 1)].map((row) => `<mergeCell ref="A${row}:${column(widths.length - 1)}${row}"/>`).join("")}</mergeCells>`}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LPerfectUtilitares&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter></worksheet>`;
}

type ReportPerson = ReturnType<typeof buildEscalaPresentation>["people"][number];

/** Keep distinct schedules; mixed journeys also retain their actual weekly application. */
function proposedRows(person: ReportPerson) {
  const variants = new Map<string, { code: string; schedule: string; interval: string; daily: string; entry: number; dates: string[]; shiftId?: string }>();
  for (const variant of person.proposedVariants) {
    const key = JSON.stringify([variant.schedule, variant.interval, variant.daily]);
    const existing = variants.get(key);
    if (existing) { existing.code += " / " + variant.code; existing.dates.push(...variant.dates); }
    else variants.set(key, { ...variant, dates: [...variant.dates], entry: Number(variant.schedule.slice(0, 2)) * 60 + Number(variant.schedule.slice(3, 5)) });
  }
  if (variants.size) return [...variants.values()].sort((a, b) => a.entry - b.entry || a.schedule.localeCompare(b.schedule));
  const code = person.cells.some(cell => cell.code === "ENC") ? "ENC" : person.cells.some(cell => cell.code === "NP") ? "NP"
    : person.cells.every(cell => cell.code === "AF") ? "AF" : person.cells.every(cell => cell.code === "FV") ? "FV" : "—";
  return [{ code, schedule: person.proposedSchedule, interval: "Não se aplica", daily: "Não apurada", entry: Infinity, dates: [] as string[], shiftId: undefined }];
}

/** Flatten before ordering: a person's later variant must not precede someone else's earlier shift. */
function hourEntries(model: ReturnType<typeof buildEscalaPresentation>, input: EscalaInput) {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  return sortScheduleEntries(model.hoursPeople.flatMap(person => proposedRows(person).map(row => {
    const application = mixedWeeklyApplication(input, person.employee, row.dates);
    const meal = shifts.get(row.shiftId ?? "")?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? segment.end - segment.start : 0), 0) ?? 0;
    return { employee: person.employee, ...row, application,
      interval: application && row.daily === "09:00" && meal ? `${row.interval} (${escalaDuration(meal)})` : row.interval };
  })));
}

/** One row per person, with the same sector/clock/name ordering as the hourly report. */
function restEntries(model: ReturnType<typeof buildEscalaPresentation>) {
  return sortScheduleEntries(model.restPeople.map(person => ({ ...person, schedule: person.proposedSchedule })));
}

function mixed42ExportNotice(input: EscalaInput): string {
  if (input.simulation !== true || input.defaultWeeklyHours !== 42 || !input.mixed42Sectors?.length) {
    return "";
  }
  const weeks = [...new Set(visibleDates(input).map(weekStart))];
  if (!input.employees.some(person => weeks.some(week => usesMixed42Week(input, person, week)))) return "";
  return "SIMULAÇÃO / NEGOCIAÇÃO: 3 × 8h + 2 × 9h nos setores selecionados; intervalo de 3h nos dias de 9h. Não é autorização operacional.";
}

export function exportEscalaXlsx(workspace: EscalaWorkspace, mode: EscalaExportMode = "both"): Uint8Array {
  const model = buildEscalaPresentation(workspace);
  const hourly = hourEntries(model, workspace.input);
  const weekly = hourly.some(row => row.application);
  const coverage = coverageReport(workspace.input);
  const simulation = workspace.input.simulation && workspace.input.policy.allowShortMealSimulation
    ? " | Simulação: pausa de 15 min dispensada entre mais de 4h e até 6h" : "";
  const mixedNotice = mixed42ExportNotice(workspace.input);
  const metadata = (title: string, description = ""): (string | number)[][] => [[model.branch],
    [title + " | " + reportPeriod(model.period) + " | Revisão " + workspace.revision + " | " + model.state + simulation],
    [[`Fechamento da loja: ${storeClosingLabel(workspace.input)}`, mixedNotice, description].filter(Boolean).join(" | ")]];
  const sectors = { main: [] as number[], hours: [] as number[], excluded: [] as number[], gaps: [] as number[] };
  const main = [...metadata("Escala de folgas", model.legend),
    ["Setor", "Matrícula", "Colaborador", "Cargo", "Horário proposto", ...model.dates.map(escalaDateLabel)]];
  const hours = [...metadata("Escala de horários", "Horários propostos; intervalos não contam como presença. Variantes reais permanecem separadas."),
    ["Setor", "Matrícula", "Colaborador", "Cargo", "Turno", "Horário proposto", "Intervalo", "Jornada diária", ...(weekly ? ["Aplicação nas semanas"] : [])]];
  let sector: string | undefined;
  for (const person of restEntries(model)) {
    const { employee, cells, proposedSchedule } = person;
    if (sector !== employee.sector) {
      sectors.main.push(main.length); main.push(["Setor: " + (employee.sector || "Não informado")]);
      sector = employee.sector;
    }
    main.push([employee.sector, employee.registration, employee.name, employee.role, proposedSchedule, ...cells.map(cell => cell.code)]);
  }
  sector = undefined;
  for (const row of hourly) {
    const { employee } = row;
    if (sector !== employee.sector) {
      sectors.hours.push(hours.length); hours.push(["Setor: " + (employee.sector || "Não informado")]); sector = employee.sector;
    }
    hours.push([employee.sector, employee.registration, employee.name, employee.role, row.code, row.schedule, row.interval, row.daily, ...(weekly ? [row.application] : [])]);
  }
  const gaps = [...metadata("Desfalques de cobertura", "Resumo por setor. Até 3 faixas prioritárias. Sem cobertura com horário não significa ninguém escalado: pessoas ENC podem estar presentes. Sem meta positiva, confirme a necessidade. Não some picos de horários diferentes."),
    ["Setor", "Dias com alerta", "Dias sem cobertura com horário (parcial / inteiro)", "Faixas prioritárias", "Maior diferença simultânea", "Base / próximo passo"],
    ...coverage.map(coverageReportCells)];
  const excluded = [...metadata("Colaboradores não incluídos", "Relação separada: não entram na grade nem na cobertura."),
    ["Situação", "Setor", "Matrícula", "Colaborador", "Cargo", "Motivo da não inclusão"]];
  sector = undefined;
  for (const { employee, code, reason } of model.excluded) {
    if (sector !== employee.sector) { sectors.excluded.push(excluded.length); excluded.push(["Setor: " + (employee.sector || "Não informado")]); sector = employee.sector; }
    excluded.push([code, employee.sector, employee.registration, employee.name, employee.role, reason]);
  }
  const sheets = [
    ...(mode !== "hours" ? [{ name: "Escala", frozenColumns: 5, rows: main, widths: [12, 9, 25, 18, 28, ...model.dates.map(() => 4.25)], grid: true, sectors: sectors.main }] : []),
    ...(mode !== "rest" ? [{ name: "Horarios", frozenColumns: 4, rows: hours, widths: [14, 9, 26, 19, 8, 32, 20, 12, ...(weekly ? [43] : [])], grid: false, sectors: sectors.hours }] : []),
    ...(coverage.length ? [{ name: "Desfalques", frozenColumns: 1, rows: gaps, widths: [23, 28, 28, 33, 27, 42], grid: false, sectors: sectors.gaps }] : []),
    ...(model.excluded.length ? [{ name: "Excluidos", frozenColumns: 4, rows: excluded, widths: [9, 18, 10, 30, 22, 42], grid: false, sectors: sectors.excluded }] : []),
  ].map(entry => ({ ...entry, rows: entry.rows.filter((_, index) => !entry.sectors.includes(index)), sectors: [] as number[] }));
  // Excel filters and sorting need contiguous records, not merged sector separator rows.
  // Each record already retains its sector; PDF keeps the visual sector bands.
  const printDefinitions = sheets.map((entry, index) => {
    const name = `'${entry.name}'`;
    const rows = `${name}!$1:$4`;
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
    "xl/styles.xml": strToU8(XLSX_REPORT_STYLES),
  };
  for (const [index, entry] of sheets.entries()) files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet(entry.rows, entry.widths, entry.grid, entry.frozenColumns, entry.sectors));
  return zipSync(files, { level: 6 });
}

function priorityWindows(row: SectorCoverageSummary): string {
  return row.windows.map(window => escalaDuration(window.start) + "-" + escalaDuration(window.end) + " · " + window.dates.length + " dia(s)").join("\n");
}

function coveragePeak(row: SectorCoverageSummary): string {
  const sector = row.peakSectorMissing ? "Até " + row.peakSectorMissing + " pessoa(s) abaixo da referência do setor" : "Quantidade total do setor atendida";
  return sector + (row.hasRoleMismatch ? "; conferir também a distribuição das funções" : "");
}

function coverageAction(row: SectorCoverageSummary): string {
  const base = row.minimumDates.length ? "Mínimo informado não atendido em " + row.minimumDates.length + " dia(s)" + (row.hasEstimates ? "; também há estimativas" : "")
    : "Estimativa automática; confirme a necessidade real";
  return base + ". Reveja entradas, intervalos e folgas. Detalhes por dia no planejamento.";
}

type CoverageReportRow = { sector: string; summary?: SectorCoverageSummary; presence?: ReturnType<typeof sectorPresenceGaps>[number] };

/** One shared row per sector, including presence facts that a zero estimate cannot report. */
function coverageReport(input: EscalaInput): CoverageReportRow[] {
  const presence = buildCoveragePresence(input);
  const groups = new Map<string, CoverageReportRow>(summarizeCoverageGaps(sectorCoverageGaps(input, presence))
    .map(summary => [summary.sector, { sector: summary.sector, summary }]));
  if (input.assignments.length) for (const gap of sectorPresenceGaps(input, presence)) {
    const row = groups.get(gap.sector) ?? { sector: gap.sector };
    row.presence = gap;
    groups.set(gap.sector, row);
  }
  return [...groups.values()].sort((a, b) => compareSectors(a.sector, b.sector));
}

function coverageReportCells(row: CoverageReportRow): string[] {
  const fullDates = row.presence?.dates ?? [];
  const full = new Set(fullDates);
  const partialDates = row.summary?.noServiceDates.filter(date => !full.has(date)) ?? [];
  const noPresence = [fullDates.length ? "Dia inteiro: " + compactDates(fullDates) : "",
    partialDates.length ? "Em alguma faixa: " + compactDates(partialDates) : ""].filter(Boolean).join("\n") || "—";
  const unknownDates = row.presence?.withoutPositiveReferenceDates ?? [];
  const action = [row.summary ? coverageAction(row.summary) : "Não há presença com horário nesses dias.",
    unknownDates.length ? "Sem referência positiva: " + compactDates(unknownDates) + ". Confirme se o setor deve funcionar nesses dias antes de ajustar folgas." : ""].filter(Boolean).join(" ");
  return [row.sector || "Não informado", row.summary ? compactDates(row.summary.dates) : "—", noPresence,
    row.summary ? priorityWindows(row.summary) : "—", row.summary ? coveragePeak(row.summary) : "Necessidade não definida", action];
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

type PdfLayout = { separateSectors?: boolean };

export async function exportEscalaPdf(workspace: EscalaWorkspace, mode: EscalaExportMode = "both", { separateSectors = true }: PdfLayout = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  const model = buildEscalaPresentation(workspace);
  const coverage = coverageReport(workspace.input);
  const sectors = [...new Set([...model.people.map(({ employee }) => employee.sector),
    ...model.excluded.map(({ employee }) => employee.sector), ...coverage.map(row => row.sector)])].sort(compareSectors);
  if (separateSectors && sectors.length) {
    for (const sector of sectors) {
      renderPdfSection(document, font, bold, workspace, mode, {
        ...model, people: model.people.filter(({ employee }) => employee.sector === sector),
        hoursPeople: model.hoursPeople.filter(({ employee }) => employee.sector === sector),
        restPeople: model.restPeople.filter(({ employee }) => employee.sector === sector),
        excluded: model.excluded.filter(({ employee }) => employee.sector === sector),
      }, coverage.filter(row => row.sector === sector), sector);
    }
  } else renderPdfSection(document, font, bold, workspace, mode, model, coverage);
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Filial ${safePdfText(workspace.input.branchCode, font)} | ${index + 1}/${pages.length}`, { x: 26, y: 16, size: 8, font }); });
  document.setTitle(`Escala - Filial ${workspace.input.branchCode} - ${model.dates[0] ?? workspace.input.startDate}`);
  return document.save();
}

function renderPdfSection(document: PDFDocument, font: PDFFont, bold: PDFFont, workspace: EscalaWorkspace, mode: EscalaExportMode,
  model: ReturnType<typeof buildEscalaPresentation>, coverage: CoverageReportRow[], sectionSector?: string) {
  const grouped = sectionSector !== undefined;
  const hourly = hourEntries(model, workspace.input);
  const weekly = hourly.some(row => row.application);
  const mixedNotice = mixed42ExportNotice(workspace.input);
  const hasRest = mode !== "hours" && (!grouped || model.restPeople.length > 0);
  let reportTitle = hasRest ? "Escala de folgas" : mode !== "rest" && model.hoursPeople.length ? "Escala de horários"
    : grouped && coverage.length ? "Desfalques de cobertura" : mode === "hours" ? "Escala de horários" : "Escala de folgas";
  const width = 842, height = 595; // A4 landscape, including full monthly grids.
  const margin = 26, labelWidth = 260, cellWidth = (width - 2 * margin - labelWidth) / Math.max(1, model.dates.length);
  let page!: PDFPage;
  let y = 0;
  const write = (text: string, x: number, baseline: number, size = 9, strong = false) => page.drawText(safePdfText(text, strong ? bold : font), { x, y: baseline, size, font: strong ? bold : font, color: rgb(0.12, 0.18, 0.26) });
  const newPage = (grid: boolean) => {
    page = document.addPage([width, height]); y = height - margin;
    for (const line of wrapText(model.branch, width - 2 * margin, bold, 12)) { write(line, margin, y, 12, true); y -= 16; }
    if (grouped) for (const line of wrapText("Setor: " + (sectionSector || "Não informado"), width - 2 * margin, bold, 10)) {
      write(line, margin, y, 10, true); y -= 14;
    }
    write(`${reportTitle} | 5x2 | ${reportPeriod(model.period)} | Versão ${workspace.revision} | ${model.state}`, margin, y, 9); y -= 15;
    write(`Fechamento da loja: ${storeClosingLabel(workspace.input)}`, margin, y, 8); y -= 12;
    if (mixedNotice) {
      for (const line of wrapText(mixedNotice, width - 2 * margin, bold, 8)) {
        write(line, margin, y, 8, true); y -= 12;
      }
    }
    if (grid) for (const line of wrapText(model.legend, width - 2 * margin, font, 8)) { write(line, margin, y, 8); y -= 12; }
    if (workspace.input.simulation && workspace.input.policy.allowShortMealSimulation) { write("Simulação: pausa de 15 min dispensada entre mais de 4h e até 6h.", margin, y, 8); y -= 13; }
    y -= 5;
    if (grid) {
      write("Escala de folgas", margin, y, 11, true); y -= 20;
      page.drawRectangle({ x: margin, y: y - 20, width: labelWidth, height: 33, color: rgb(0.91, 0.94, 0.97), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
      write("Matrícula / colaborador", margin, y, 9, true);
      model.dates.forEach((date, index) => {
        const x = margin + labelWidth + index * cellWidth;
        const sunday = new Date(date + "T00:00:00Z").getUTCDay() === 0;
        page.drawRectangle({ x, y: y - 20, width: cellWidth, height: 33, color: sunday ? rgb(0.82, 0.87, 0.94) : rgb(0.94, 0.96, 0.98), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
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
  const textHeight = (text: string, size = 8.5, strong = false) => wrapText(text, width - 2 * margin, strong ? bold : font, size).length * (size + 4);
  const sectionHeight = (title: string) => 8 + textHeight(title, 11, true);
  const cellHeight = (lines: string[][]) => Math.max(...lines.map(values => values.length)) * 11 + 8;
  const headerLines = (headings: string[], widths: number[]) => headings.map((heading, index) => wrapText(heading, widths[index] - 7, bold, 8));
  const firstRowHeight = (lines: string[][]) => {
    const height = cellHeight(lines);
    return height <= 400 ? height : 19; // Oversized rows can start with one line.
  };
  const tableHeadings = (headings: string[], widths: number[]) => {
    const lines = headerLines(headings, widths);
    const rowHeight = cellHeight(lines);
    if (y - rowHeight < 45) newPage(false);
    let x = margin;
    lines.forEach((values, index) => {
      page.drawRectangle({ x, y: y - rowHeight + 11, width: widths[index], height: rowHeight, color: rgb(0.89, 0.92, 0.96), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
      values.forEach((value, line) => { write(value, x + 3, y - line * 11, 8, true); });
      x += widths[index];
    });
    y -= rowHeight;
  };
  newPage(hasRest);
  if (mode === "hours" && (!grouped || model.hoursPeople.length)) paragraph(model.legend, 8);
  /** A logical row can span pages; repeat short context cells beside continued content. */
  const paginatedRow = (lines: string[][], widths: number[], size: number, strong: (column: number, line: string) => boolean, continuePage: () => void) => {
    const count = Math.max(...lines.map(values => values.length));
    const totalHeight = count * 11 + 8;
    if (y - totalHeight < 45 && totalHeight <= 400) continuePage();
    let offset = 0;
    while (offset < count) {
      if (Math.floor((y - 45 - 8) / 11) < 1) continuePage();
      const capacity = Math.max(1, Math.floor((y - 45 - 8) / 11));
      const length = Math.min(count - offset, capacity);
      const fragment = lines.map(values => values.slice(offset, offset + length).length
        ? values.slice(offset, offset + length) : offset && values.length <= length ? values : []);
      const rowHeight = Math.max(...fragment.map(values => values.length)) * 11 + 8;
      let x = margin;
      fragment.forEach((values, index) => {
        page.drawRectangle({ x, y: y - rowHeight + 11, width: widths[index], height: rowHeight, color: rgb(0.98, 0.99, 1), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
        values.forEach((line, position) => { write(line, x + 3, y - position * 11, size, strong(index, line)); });
        x += widths[index];
      });
      y -= rowHeight;
      offset += length;
      if (offset < count) continuePage();
    }
  };
  let sector = "";
  for (const { employee, cells, proposedSchedule, proposedVariants } of mode === "hours" ? [] : restEntries(model)) {
    const names = wrapText(`${employee.registration} - ${employee.name}`, labelWidth - 12, bold, 9);
    const roles = wrapText(employee.role, labelWidth - 12, font, 7.5);
    const proposed = wrapText(proposedVariants.length > 1 ? "Horário variável: " + proposedVariants.map((entry) => entry.code).join(", ") + " (ver horários)" : "Horário proposto: " + proposedSchedule, labelWidth - 12, font, 7);
    const rowHeight = Math.max(30, names.length * 12 + roles.length * 10 + proposed.length * 9 + 4);
    const sectorLines = wrapText(employee.sector || "Setor não informado", width - 2 * margin - 8, bold, 9);
    const sectorHeight = sectorLines.length * 12 + 8;
    if (y - rowHeight - (sector !== employee.sector ? sectorHeight : 0) < 45) { newPage(true); sector = ""; }
    if (sector !== employee.sector || !sector) {
      page.drawRectangle({ x: margin, y: y - sectorHeight + 13, width: width - 2 * margin, height: sectorHeight, color: rgb(0.88, 0.92, 0.97) });
      for (const line of sectorLines) { write(line, margin + 4, y, 9, true); y -= 12; }
      y -= 8; sector = employee.sector;
    }
    page.drawRectangle({ x: margin, y: y - rowHeight + 12, width: labelWidth, height: rowHeight, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
    names.forEach((line, index) => { write(line, margin + 3, y - index * 12, 9, true); });
    roles.forEach((line, index) => { write(line, margin, y - names.length * 12 - index * 10, 7.5); });
    proposed.forEach((line, index) => { write(line, margin, y - names.length * 12 - roles.length * 10 - index * 9, 7); });
    cells.forEach((cell, index) => {
      const x = margin + labelWidth + index * cellWidth;
      const fill = cell.code === "F" ? rgb(0.89, 0.91, 0.97) : cell.code === "NP" ? rgb(0.98, 0.91, 0.91)
        : ["AF", "ENC", "FV"].includes(cell.code) ? rgb(0.91, 0.94, 0.97) : new Date(model.dates[index] + "T00:00:00Z").getUTCDay() === 0 ? rgb(0.96, 0.97, 0.99) : rgb(1, 1, 1);
      page.drawRectangle({ x, y: y - rowHeight + 12, width: cellWidth, height: rowHeight, color: fill, borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
      const codeSize = cell.code.length > 2 ? 7 : 7.5;
      const codeFont = cell.code === "F" ? bold : font;
      write(cell.code, x + Math.max(1, (cellWidth - codeFont.widthOfTextAtSize(cell.code, codeSize)) / 2), y, codeSize, cell.code === "F");
    });
    y -= rowHeight;
  }
  if (!grouped && !model.people.length) paragraph("Nenhum colaborador incluído nesta proposta.");
  if (mode !== "rest" && (!grouped || hourly.length)) {
    reportTitle = "Escala de horários";
    if (mode === "both" && !grouped) newPage(false);
    const description = "Horários propostos por colaborador. Variantes reais permanecem separadas; intervalos não contam como presença.";
    let hoursSector: string | undefined;
    const widths = (weekly ? [0.20, 0.10, 0.05, 0.23, 0.13, 0.08, 0.21] : [0.27, 0.18, 0.05, 0.27, 0.15, 0.08]).map(ratio => ratio * (width - 2 * margin));
    const headings = ["Matrícula / colaborador", "Cargo", "Turno", "Horário proposto", "Intervalo", "Jornada", ...(weekly ? ["Aplicação nas semanas"] : [])];
    const headerHeight = cellHeight(headerLines(headings, widths));
    const hoursHeader = () => tableHeadings(headings, widths);
    const rows = hourly.map(row => {
      const { employee } = row;
      const cells = [employee.registration + " - " + employee.name, employee.role, row.code, row.schedule, row.interval, row.daily === "Não apurada" ? "—" : row.daily, ...(weekly ? [row.application] : [])];
      const lines = cells.map((value, index) => value.split("\n").flatMap(part => wrapText(part, widths[index] - 7, index === 0 ? bold : font, 8.5)));
      return { employee, lines, sectorHeight: sectionHeight(employee.sector || "Setor não informado") + headerHeight };
    });
    const first = rows[0];
    if (grouped && first && y - sectionHeight(reportTitle) - textHeight(description) - first.sectorHeight - firstRowHeight(first.lines) < 45) newPage(false);
    section(reportTitle);
    paragraph(description);
    for (const { employee, lines, sectorHeight } of rows) {
      if (y - firstRowHeight(lines) - (hoursSector !== employee.sector ? sectorHeight : 0) < 45) { newPage(false); hoursSector = undefined; }
      if (hoursSector !== employee.sector) {
        section(employee.sector || "Setor não informado"); hoursSector = employee.sector; hoursHeader();
      }
      paginatedRow(lines, widths, 8.5, index => index === 0, () => {
        newPage(false); section((employee.sector || "Setor não informado") + " (continuação)"); hoursHeader();
      });
    }
  }
  if (model.excluded.length) {
    section("Colaboradores não incluídos — relação separada");
    for (const { employee, code, reason } of model.excluded) {
      paragraph(code + " | " + employee.sector + " | " + employee.registration + " - " + employee.name + " | " + employee.role, 9, true);
      paragraph("Motivo: " + reason);
    }
  }
  if (coverage.length) {
    reportTitle = "Desfalques de cobertura";
    const descriptions = [
      "Um resumo por setor, sem repetir cargos ou pequenas variações de horário. Até 3 faixas prioritárias; outras ocorrências ficam na consulta por dia do planejamento.",
      "Os picos não se somam. Estimativa automática não é demanda confirmada nem indicação de contratação.",
      "Dia inteiro sem cobertura com horário definido não significa ninguém escalado: pessoas ENC podem estar presentes. Sem referência positiva, confirme a necessidade do setor.",
    ];
    const widths = [0.16, 0.20, 0.23, 0.16, 0.25].map(ratio => (width - 2 * margin) * ratio);
    const headings = ["Setor", "Dias com alerta / sem cobertura com horário", "Faixas prioritárias", "Maior diferença", "Base / próximo passo"];
    const tableHeader = () => tableHeadings(headings, widths);
    const continuation = () => { newPage(false); tableHeader(); };
    const rows = coverage.map(row => {
      const [sector, alerts, presence, windows, peak, action] = coverageReportCells(row);
      const cells = [sector, "Com desfalque: " + alerts + "\n" + presence, windows, peak, action];
      return cells.map((cell, index) => cell.split("\n").flatMap(part => wrapText(part, widths[index] - 7, index === 0 ? bold : font, 8)));
    });
    const introHeight = sectionHeight(reportTitle) + descriptions.reduce((sum, description) => sum + textHeight(description), 0) + cellHeight(headerLines(headings, widths));
    if (!grouped || y - introHeight - firstRowHeight(rows[0]) < 45) newPage(false);
    section(reportTitle);
    for (const description of descriptions) paragraph(description);
    tableHeader();
    for (const lines of rows) {
      paginatedRow(lines, widths, 8, index => index === 0, continuation);
    }
  }
}
