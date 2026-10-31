import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import type { EscalaInput, EscalaWorkspace } from "./types";
import { compareSectors, sortScheduleEntries } from "./order";
import { buildCoveragePresence, consolidateCoverageGaps, coverageTimeline, sectorCoverageGaps, type CoveragePresence, type SectorCoverageGap } from "./coverage-presence";
import { buildEscalaPresentation, escalaDateLabel, escalaDuration, type EscalaExportMode } from "./presentation";

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

/** Split, never truncate; prefer complete role descriptions at continuation boundaries. */
function spreadsheetFragments(text: string, width: number, maximumLines = 24): string[] {
  const fragments: string[] = [];
  let remaining = [...text];
  while (remaining.length && spreadsheetLines(remaining.join(""), width) > maximumLines) {
    let low = 1, high = remaining.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (spreadsheetLines(remaining.slice(0, middle).join(""), width) <= maximumLines) low = middle;
      else high = middle - 1;
    }
    const prefix = remaining.slice(0, low).join("");
    const boundary = prefix.lastIndexOf("\n") + 1;
    const length = boundary > prefix.length / 2 ? [...prefix.slice(0, boundary)].length : low;
    fragments.push(remaining.slice(0, length).join(""));
    remaining = remaining.slice(length);
  }
  if (remaining.length || !fragments.length) fragments.push(remaining.join(""));
  return fragments;
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

/** Reporting keeps all distinct proposed schedules, not dates or repeated folga rows. */
function proposedRows(person: ReportPerson) {
  const variants = new Map<string, { code: string; schedule: string; interval: string; daily: string; entry: number }>();
  for (const variant of person.proposedVariants) {
    const key = JSON.stringify([variant.schedule, variant.interval, variant.daily]);
    const existing = variants.get(key);
    if (existing) existing.code += " / " + variant.code;
    else variants.set(key, { ...variant, entry: Number(variant.schedule.slice(0, 2)) * 60 + Number(variant.schedule.slice(3, 5)) });
  }
  if (variants.size) return [...variants.values()].sort((a, b) => a.entry - b.entry || a.schedule.localeCompare(b.schedule));
  const code = person.cells.some(cell => cell.code === "ENC") ? "ENC" : person.cells.some(cell => cell.code === "NP") ? "NP"
    : person.cells.every(cell => cell.code === "AF") ? "AF" : person.cells.every(cell => cell.code === "FV") ? "FV" : "—";
  return [{ code, schedule: person.proposedSchedule, interval: "Não se aplica", daily: "Não apurada", entry: Infinity }];
}

/** Flatten before ordering: a person's later variant must not precede someone else's earlier shift. */
function hourEntries(model: ReturnType<typeof buildEscalaPresentation>) {
  return sortScheduleEntries(model.hoursPeople.flatMap(person => proposedRows(person).map(row => ({ employee: person.employee, ...row }))));
}

/** One row per person, with the same sector/clock/name ordering as the hourly report. */
function restEntries(model: ReturnType<typeof buildEscalaPresentation>) {
  return sortScheduleEntries(model.restPeople.map(person => ({ ...person, schedule: person.proposedSchedule })));
}

/** The envelope is observed/reference data, never an invented store opening time. */
function coverageWindows(input: EscalaInput, gaps: SectorCoverageGap[], presence: CoveragePresence) {
  const windows = new Map<string, string>();
  for (const gap of gaps) {
    const key = gap.date + "\0" + gap.sector;
    if (windows.has(key)) continue;
    const timeline = coverageTimeline(input, gap.date, gap.sector, presence);
    windows.set(key, escalaDuration(timeline[0]?.start ?? gap.start) + "-" + escalaDuration(timeline.at(-1)?.end ?? gap.end));
  }
  return windows;
}

function gapSchedule(gap: SectorCoverageGap) {
  return escalaDuration(gap.start) + "-" + escalaDuration(gap.end);
}

/** Presentation only: preserve different counts/bases/dates, deduplicate identical occurrences. */
function orderedCoverageGaps(gaps: SectorCoverageGap[]): SectorCoverageGap[] {
  const rolesOrder = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  const unique = new Map<string, SectorCoverageGap>();
  for (const gap of gaps) {
    const roles = [...new Map(gap.roles.map(role => [JSON.stringify([role.role, role.present, role.minimum, role.estimated]), role])).values()]
      .sort((a, b) => rolesOrder.compare(a.role, b.role) || Number(a.estimated) - Number(b.estimated) || a.minimum - b.minimum || a.present - b.present);
    const entry = { ...gap, roles };
    const key = JSON.stringify([gap.sector, gap.date, gap.start, gap.end, gap.present, gap.minimum, gap.estimated, gap.kind, roles]);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()].sort((a, b) => compareSectors(a.sector, b.sector)
    || a.start - b.start || a.end - b.end || a.date.localeCompare(b.date)
    || Number(a.estimated) - Number(b.estimated));
}

export function exportEscalaXlsx(workspace: EscalaWorkspace, mode: EscalaExportMode = "both"): Uint8Array {
  const model = buildEscalaPresentation(workspace);
  const presence = buildCoveragePresence(workspace.input);
  const diagnostics = { coverageGroups: orderedCoverageGaps(sectorCoverageGaps(workspace.input, presence)) };
  const windows = coverageWindows(workspace.input, diagnostics.coverageGroups, presence);
  const simulation = workspace.input.simulation && workspace.input.policy.allowShortMealSimulation
    ? " | Simulação: pausa de 15 min dispensada entre mais de 4h e até 6h" : "";
  const metadata = (title: string, description = ""): (string | number)[][] => [[model.branch],
    [title + " | " + reportPeriod(model.period) + " | Revisão " + workspace.revision + " | " + model.state + simulation], [description]];
  const sectors = { main: [] as number[], hours: [] as number[], excluded: [] as number[], gaps: [] as number[] };
  const main = [...metadata("Escala de folgas", model.legend),
    ["Setor", "Matrícula", "Colaborador", "Cargo", "Horário proposto", ...model.dates.map(escalaDateLabel)]];
  const hours = [...metadata("Escala de horários", "Horários propostos; intervalos não contam como presença. Variantes reais permanecem separadas."),
    ["Setor", "Matrícula", "Colaborador", "Cargo", "Turno", "Horário proposto", "Intervalo", "Jornada diária"]];
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
  for (const row of hourEntries(model)) {
    const { employee } = row;
    if (sector !== employee.sector) {
      sectors.hours.push(hours.length); hours.push(["Setor: " + (employee.sector || "Não informado")]); sector = employee.sector;
    }
    hours.push([employee.sector, employee.registration, employee.name, employee.role, row.code, row.schedule, row.interval, row.daily]);
  }
  const gaps = [...metadata("Desfalques de cobertura", "Por setor e horário. Presentes/referência são do setor; funções detalham a mesma ocorrência, sem somar faltas novamente. Estimada = referência automática."),
    ["Data", "Setor", "Horário com desfalque", "Presentes no setor", "Referência do setor", "Base", "Funções / cargos a revisar", "Faixa analisada"]];
  sector = undefined;
  for (const gap of diagnostics.coverageGroups) {
    if (sector !== gap.sector) { sectors.gaps.push(gaps.length); gaps.push(["Setor: " + (gap.sector || "Não informado")]); sector = gap.sector; }
    const descriptions = gap.roles.length ? gap.roles.map(coverageRoleDescription).join("\n") : coverageRoles(gap);
    const fragments = spreadsheetFragments(descriptions, 34);
    fragments.forEach((roles, index) => {
      gaps.push([gap.date, gap.sector, gapSchedule(gap), index ? "" : gap.present, index ? "" : gap.minimum, index ? "" : gap.estimated ? "Estimada" : "Mínimo informado", roles,
        (windows.get(gap.date + "\0" + gap.sector) ?? gapSchedule(gap)) + (index ? ` (continuação ${index + 1}/${fragments.length})` : "")]);
    });
  }
  const excluded = [...metadata("Colaboradores não incluídos", "Relação separada: não entram na grade nem na cobertura."),
    ["Situação", "Setor", "Matrícula", "Colaborador", "Cargo", "Motivo da não inclusão"]];
  sector = undefined;
  for (const { employee, code, reason } of model.excluded) {
    if (sector !== employee.sector) { sectors.excluded.push(excluded.length); excluded.push(["Setor: " + (employee.sector || "Não informado")]); sector = employee.sector; }
    excluded.push([code, employee.sector, employee.registration, employee.name, employee.role, reason]);
  }
  const sheets = [
    ...(mode !== "hours" ? [{ name: "Escala", frozenColumns: 5, rows: main, widths: [12, 9, 25, 18, 28, ...model.dates.map(() => 4.25)], grid: true, sectors: sectors.main }] : []),
    ...(mode !== "rest" ? [{ name: "Horarios", frozenColumns: 4, rows: hours, widths: [14, 9, 26, 19, 8, 32, 20, 12], grid: false, sectors: sectors.hours }] : []),
    ...(diagnostics.coverageGroups.length ? [{ name: "Desfalques", frozenColumns: 2, rows: gaps, widths: [12, 19, 19, 11, 12, 16, 34, 21], grid: false, sectors: sectors.gaps }] : []),
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

function coverageSituation(gap: SectorCoverageGap): string {
  return gap.kind === "no-service" ? "Sem presença no horário" : gap.estimated ? "Abaixo da estimativa" : "Mínimo não atendido";
}
function coverageRoles(gap: SectorCoverageGap): string {
  return gap.roles.length ? gap.roles.map(coverageRoleDescription).join("; ") : "Referência do setor, sem função específica";
}

function coverageRoleDescription(role: SectorCoverageGap["roles"][number]): string {
  return role.role + ": " + role.present + " presente(s), referência " + role.minimum + (role.estimated ? " estimada" : " informada");
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
  const presence = buildCoveragePresence(workspace.input);
  const diagnostics = { coverageGroups: orderedCoverageGaps(sectorCoverageGaps(workspace.input, presence)) };
  let reportTitle = mode === "hours" ? "Escala de horários" : "Escala de folgas";
  const font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 842, height = 595; // A4 landscape, including full monthly grids.
  const margin = 26, labelWidth = 260, cellWidth = (width - 2 * margin - labelWidth) / Math.max(1, model.dates.length);
  let page!: PDFPage;
  let y = 0;
  const write = (text: string, x: number, baseline: number, size = 9, strong = false) => page.drawText(safePdfText(text, strong ? bold : font), { x, y: baseline, size, font: strong ? bold : font, color: rgb(0.12, 0.18, 0.26) });
  const newPage = (grid: boolean) => {
    page = document.addPage([width, height]); y = height - margin;
    for (const line of wrapText(model.branch, width - 2 * margin, bold, 12)) { write(line, margin, y, 12, true); y -= 16; }
    write(`${reportTitle} | 5x2 | ${reportPeriod(model.period)} | Versão ${workspace.revision} | ${model.state}`, margin, y, 9); y -= 15;
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
  const tableHeadings = (headings: string[], widths: number[]) => {
    const lines = headings.map((heading, index) => wrapText(heading, widths[index] - 7, bold, 8));
    const rowHeight = Math.max(...lines.map(values => values.length)) * 11 + 8;
    if (y - rowHeight < 45) newPage(false);
    let x = margin;
    lines.forEach((values, index) => {
      page.drawRectangle({ x, y: y - rowHeight + 11, width: widths[index], height: rowHeight, color: rgb(0.89, 0.92, 0.96), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
      values.forEach((value, line) => { write(value, x + 3, y - line * 11, 8, true); });
      x += widths[index];
    });
    y -= rowHeight;
  };
  newPage(mode !== "hours");
  if (mode === "hours") paragraph(model.legend, 8);
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
  if (!model.people.length) paragraph("Nenhum colaborador incluído nesta proposta.");
  if (mode !== "rest") {
    reportTitle = "Escala de horários";
    if (mode === "both") newPage(false);
    section("Escala de horários");
    paragraph("Horários propostos por colaborador. Variantes reais permanecem separadas; intervalos não contam como presença.");
    let hoursSector: string | undefined;
    const widths = [0.27, 0.18, 0.05, 0.27, 0.15, 0.08].map(ratio => ratio * (width - 2 * margin));
    const headings = ["Matrícula / colaborador", "Cargo", "Turno", "Horário proposto", "Intervalo", "Jornada"];
    const headerHeight = Math.max(...headings.map((heading, index) => wrapText(heading, widths[index] - 7, bold, 8).length)) * 11 + 8;
    const hoursHeader = () => tableHeadings(headings, widths);
    for (const row of hourEntries(model)) {
      const { employee } = row;
      const cells = [employee.registration + " - " + employee.name, employee.role, row.code, row.schedule, row.interval, row.daily === "Não apurada" ? "—" : row.daily];
      const lines = cells.map((value, index) => wrapText(value, widths[index] - 7, index === 0 ? bold : font, 8.5));
      const rowHeight = Math.max(...lines.map(value => value.length)) * 11 + 8;
      const sectorHeight = 8 + wrapText(employee.sector || "Setor não informado", width - 2 * margin, bold, 11).length * 15 + headerHeight;
      // Match paginatedRow: ordinary rows stay whole; oversized rows start with one visible line.
      const firstFragmentHeight = rowHeight <= 400 ? rowHeight : 19;
      if (y - firstFragmentHeight - (hoursSector !== employee.sector ? sectorHeight : 0) < 45) { newPage(false); hoursSector = undefined; }
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
  if (diagnostics.coverageGroups.length) {
    reportTitle = "Desfalques de cobertura";
    newPage(false);
    section("Desfalques de cobertura");
    paragraph("Por setor e horário. Presentes/referência são do setor; os cargos detalham a mesma ocorrência, sem somar faltas novamente. Estimada: referência automática.");
    // A shortage is defined by its facts, not a day's wider observed envelope.
    // Keep every date and real count/base difference; Excel retains daily envelopes.
    const grouped = consolidateCoverageGaps(diagnostics.coverageGroups);
    const ordered = [...grouped].sort((left, right) => compareSectors(left.sector, right.sector)
      || left.start - right.start || left.end - right.end || left.dates[0].localeCompare(right.dates[0])
      || Number(left.estimated) - Number(right.estimated));
    const widths = [0.14, 0.15, 0.07, 0.08, 0.40, 0.16].map((ratio) => (width - 2 * margin) * ratio);
    const headings = ["Dia(s)", "Horário com desfalque", "Presentes", "Referência", "Funções / cargos a revisar", "Situação / base"];
    const tableHeader = () => {
      if (y < 85) newPage(false);
      tableHeadings(headings, widths);
    };
    const continuation = (sector: string) => {
      newPage(false); paragraph("Desfalques de cobertura (continuação)", 11, true); tableHeader();
      section((sector || "Setor não informado") + " (continuação)");
    };
    tableHeader();
    let coverageSector: string | undefined;
    for (const gap of ordered) {
      const context = coverageSituation(gap) + (gap.estimated ? " — Estimada" : " — Mínimo informado");
      const cells = [compactDates(gap.dates), gapSchedule(gap), String(gap.present), String(gap.minimum), coverageRoles(gap), context];
      const lines = cells.map((cell, index) => cell.split("\n").flatMap(part => wrapText(part, widths[index] - 7, index === 4 || index === 1 ? bold : font, 8)));
      const rowHeight = Math.max(...lines.map(value => value.length)) * 11 + 8;
      const sectorHeight = 8 + wrapText(gap.sector || "Setor não informado", width - 2 * margin, bold, 11).length * 15;
      const firstFragment = rowHeight <= 400 ? rowHeight : 19;
      if (y - firstFragment - (coverageSector !== gap.sector ? sectorHeight : 0) < 45) {
        continuation(gap.sector); coverageSector = gap.sector;
      }
      if (coverageSector !== gap.sector) { section(gap.sector || "Setor não informado"); coverageSector = gap.sector; }
      paginatedRow(lines, widths, 8, index => index === 4 || index === 1, () => continuation(gap.sector));
    }
    paragraph("Ajustes e conferências ficam na área de suporte do planejamento.");
  }
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Filial ${safePdfText(workspace.input.branchCode, font)} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Escala - Filial ${workspace.input.branchCode} - ${model.dates[0] ?? workspace.input.startDate}`);
  return document.save();
}
