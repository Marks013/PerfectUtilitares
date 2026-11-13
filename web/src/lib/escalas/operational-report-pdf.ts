import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EscalaError } from "./errors";
import { dayOfWeek, weekStart } from "./dates";
import { escalaDateLabel, escalaDuration } from "./presentation";
import { coverageObservation, coverageReportRows, type OperationalReportModel, type OperationalPresenceRow } from "./operational-report";
import { OPERATIONAL_REPORT_SECTION_LABELS } from "./operational-report-contracts";

/** Vector-only report of an immutable saved revision. No scheduling or persistence occurs here. */
export async function exportOperationalReportPdf(model: OperationalReportModel): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  let fonts: [PDFFont, PDFFont];
  try {
    document.registerFontkit(fontkit);
    const [regular, strong] = await Promise.all([
      readFile(join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf")),
      readFile(join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf")),
    ]);
    fonts = [await document.embedFont(regular, { subset: true }), await document.embedFont(strong, { subset: true })];
  } catch {
    throw new EscalaError(422, "ESCALA_OPERATIONAL_FONT_UNAVAILABLE", "As fontes deste PDF não estão disponíveis. Use a planilha da escala ou solicite suporte. Os dados foram mantidos.");
  }
  const [font, bold] = fonts;
  const regularCharacters = new Set(font.getCharacterSet()), boldCharacters = new Set(bold.getCharacterSet());
  const width = 842, height = 595, margin = 26, available = width - margin * 2;
  let page!: PDFPage;
  let y = 0, sector = "", title = "";
  const clean = (value: string) => {
    for (const character of value) {
      if (character === "\n") continue; // Layout delimiter; identification characters remain unchanged.
      const point = character.codePointAt(0);
      if (point === undefined || point < 32 || !regularCharacters.has(point) || !boldCharacters.has(point)) {
        throw new EscalaError(422, "ESCALA_OPERATIONAL_FONT_UNSUPPORTED", "Este PDF ainda não suporta um dos caracteres do cadastro. Use a planilha da escala ou solicite suporte. Os dados foram mantidos.");
      }
    }
    return value;
  };
  [model.branch, model.status, ...model.sectors].forEach(clean);
  if (model.options.sections.some(section => section === "calendar" || section === "journeys" || section === "presence")) {
    for (const person of model.people) [person.employee.registration, person.employee.name, person.employee.role, person.employee.sector].forEach(clean);
  }
  const wrap = (value: string, measure: number, size = 9, strong = false) => {
    const face = strong ? bold : font, result: string[] = [];
    for (const paragraph of clean(value).split("\n")) {
      let rest = paragraph;
      while (face.widthOfTextAtSize(rest, size) > measure) {
        const characters = [...rest]; let count = 1;
        while (count < characters.length && face.widthOfTextAtSize(characters.slice(0, count + 1).join(""), size) <= measure) count++;
        const candidate = characters.slice(0, count).join(""), space = candidate.lastIndexOf(" ");
        const cut = space >= 0 ? [...candidate.slice(0, space + 1)].length : count;
        result.push(characters.slice(0, cut).join("")); rest = characters.slice(cut).join("");
      }
      result.push(rest);
    }
    return result;
  };
  const text = (value: string, x: number, baseline: number, size = 9, strong = false) => page.drawText(clean(value), { x, y: baseline, size, font: strong ? bold : font, color: rgb(0.12, 0.18, 0.26) });
  const newPage = () => {
    page = document.addPage([width, height]); y = height - margin - 12;
    for (const line of wrap(model.branch, available, 12, true)) { text(line, margin, y, 12, true); y -= 16; }
    text(`${model.options.month} | Revisão ${model.revision} | ${model.status} | Previsto na grade`, margin, y); y -= 16;
    for (const line of wrap(`Setor: ${sector || "Não informado"} | ${title}`, available, 10, true)) { text(line, margin, y, 10, true); y -= 15; }
    y -= 8;
  };
  const paragraph = (value: string, size = 9) => {
    for (const line of wrap(value, available, size)) { if (y < 50) newPage(); text(line, margin, y, size); y -= size + 4; }
    y -= 4;
  };
  const table = (headings: string[], rows: string[][], weights: number[], padding = 4) => {
    if (!rows.length) { paragraph("Sem registros para esta seção."); return; }
    const sum = weights.reduce((a, b) => a + b, 0), widths = weights.map(value => value / sum * available);
    const headerLines = headings.map((value, i) => wrap(value, widths[i] - padding * 2, 8.5, true));
    const headerHeight = Math.max(...headerLines.map(lines => lines.length)) * 12 + 8;
    const header = () => {
      if (y - headerHeight - 20 < 45) newPage();
      let x = margin;
      headerLines.forEach((lines, i) => {
        page.drawRectangle({ x, y: y - headerHeight + 9, width: widths[i], height: headerHeight, color: rgb(0.89, 0.92, 0.96), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
        lines.forEach((line, j) => { text(line, x + padding, y - j * 12, 8.5, true); }); x += widths[i];
      }); y -= headerHeight;
    };
    header();
    for (const row of rows) {
      const lines = headings.map((_, i) => wrap(row[i] ?? "—", widths[i] - padding * 2, 8.5));
      const count = Math.max(...lines.map(part => part.length)); let offset = 0;
      if (count * 12 + 8 <= 350 && y - count * 12 - 8 < 45) { newPage(); header(); }
      while (offset < count) {
        if (Math.floor((y - 45 - 8) / 12) < 1) { newPage(); header(); }
        const length = Math.min(count - offset, Math.max(1, Math.floor((y - 45 - 8) / 12))), rowHeight = length * 12 + 8;
        let x = margin;
        lines.forEach((part, i) => {
          const values = part.slice(offset, offset + length);
          if (!values.length && offset && part.length <= length) values.push(...part);
          page.drawRectangle({ x, y: y - rowHeight + 9, width: widths[i], height: rowHeight, color: rgb(0.98, 0.99, 1), borderColor: rgb(0.79, 0.83, 0.88), borderWidth: 0.4 });
          values.forEach((line, j) => { text(line, x + padding, y - j * 12, 8.5); }); x += widths[i];
        }); y -= rowHeight; offset += length;
        if (offset < count) { newPage(); header(); }
      }
    }
    y -= 12;
  };
  const duration = (minutes: number | null) => minutes === null ? "Não apurado" : escalaDuration(minutes);
  for (const selectedSector of model.sectors) {
    sector = selectedSector;
    const people = model.people.filter(row => row.employee.sector === sector);
    for (const section of model.options.sections) {
      title = OPERATIONAL_REPORT_SECTION_LABELS[section];
      if (section === "presence") title += " | " + model.options.date;
      newPage();
      if (model.referencesOnly) paragraph("Referências de horários, sem grade diária.");
      if (section === "summary") {
        paragraph("Pessoas-dia por categoria. Sem horário e DUTY não compõem atendimento por relógio.");
        const days = model.operations.days.filter(day => day.sector === sector);
        const total = (field: "workTimed" | "workWithoutClock" | "duty" | "off" | "absence" | "holiday" | "unassigned") => days.reduce((sum, day) => sum + day.counts[field], 0);
        paragraph(`No mês, pessoas-dia: WORK com horário ${total("workTimed")}; sem horário ${total("workWithoutClock")}; DUTY ${total("duty")}; OFF ${total("off")}; afastamento ${total("absence")}; feriado ${total("holiday")}; sem registro ${total("unassigned")}.`);
        paragraph(`OFF nos sábados: ${days.filter(day => dayOfWeek(day.date) === 5).reduce((sum, day) => sum + day.counts.off, 0)}; OFF nos domingos: ${days.filter(day => dayOfWeek(day.date) === 6).reduce((sum, day) => sum + day.counts.off, 0)}.`);
        table(["Dia", "WORK com horário", "WORK sem horário", "DUTY", "OFF", "AF", "HOLIDAY", "Sem registro", "Horas WORK"], days.map(day => [
          escalaDateLabel(day.date), String(day.counts.workTimed), String(day.counts.workWithoutClock), String(day.counts.duty), String(day.counts.off),
          String(day.counts.absence), String(day.counts.holiday), String(day.counts.unassigned), day.workPersonMinutes === null ? "Não apurado; conhecido: " + duration(day.knownWorkPersonMinutes) : duration(day.workPersonMinutes),
        ]), [1.2, 1, 1, 0.7, 0.7, 0.7, 1, 1, 1.2]);
        const excluded = model.excluded.filter(row => row.employee.sector === sector);
        if (excluded.length) paragraph(`Não incluídos: ${excluded.length}. Relação separada da equipe prevista.`);
        if (days.some(day => day.status === "PARTIAL")) paragraph("Dados com lacunas: horas totais não apuradas; os estados conhecidos foram preservados.");
      }
      if (section === "calendar") {
        const calendarPeople = people.filter(person => person.employee.planningEnabled !== false);
        paragraph("F = OFF; AF = afastamento; FE = feriado fechado; ENC = sem horário fixo; NP = não processado; FV = fora do vínculo. Não são registros de ponto.");
        const weeks = [...new Set(model.dates.map(weekStart))];
        const largestCode = Math.max(0, ...calendarPeople.flatMap(person => person.cells.map(cell => font.widthOfTextAtSize(clean(cell.code), 8.5))));
        const fullMonthFits = largestCode <= available / (8 + model.dates.length) - 2;
        const blocks = fullMonthFits ? [model.dates] : Array.from({ length: Math.ceil(weeks.length / 3) }, (_, i) =>
          model.dates.filter(date => weeks.slice(i * 3, i * 3 + 3).includes(weekStart(date))));
        for (const [i, dates] of blocks.entries()) {
          if (i) newPage();
          paragraph("Semanas civis: " + [...new Set(dates.map(weekStart))].map(date => date.slice(8) + "/" + date.slice(5, 7)).join(", "));
          table(["Matrícula / nome / cargo", ...dates.map(date => date.slice(8) + "\n" + escalaDateLabel(date).split(" ")[1])], calendarPeople.map(person => [
            `${person.employee.registration} - ${person.employee.name}\n${person.employee.role}\nFolga: ${person.employee.offMode === "VARIABLE" ? "Variável" : !person.employee.fixedOffDays.length ? "Sem dia fixo informado" : (person.employee.offMode === "MIXED" ? "Variável e fixa: " : "Fixa: ") + [...new Set(model.dates.filter(date => person.employee.fixedOffDays.includes(dayOfWeek(date))).map(date => escalaDateLabel(date).split(" ")[1]))].join(", ")}`,
            ...dates.map(date => person.cells.find(cell => cell.date === date)?.code ?? "NP"),
          ]), [8, ...dates.map(() => 1)], 1);
        }
      }
      if (section === "journeys") {
        paragraph("Jornadas e pausas atribuídas; sem grade, são apenas referências.");
        const rows = people.flatMap(person => person.proposedVariants.length ? person.proposedVariants.map(variant => [
          `${person.employee.registration} - ${person.employee.name}\n${person.employee.role}`, variant.code, variant.schedule, variant.interval, variant.daily,
          variant.dates.length ? variant.dates.map(date => date.slice(8) + "/" + date.slice(5, 7)).join(", ") : "Referência sem datas",
        ]) : [[`${person.employee.registration} - ${person.employee.name}\n${person.employee.role}`, "—", person.proposedSchedule, "Não se aplica", "Não apurada", model.referencesOnly ? "Sem datas" : "Sem WORK com horário"]]);
        table(["Colaborador", "Turno", "WORK", "Pausas", "Jornada", "Aplicação"], rows, [2.2, 0.7, 2.3, 1.8, 0.8, 1.8]);
      }
      if (section === "variants") {
        paragraph("Uma linha por variante. Pessoas podem compartilhar variantes: não somar como equipe única. Datas indicam uso por alguma pessoa; aplicação individual em Jornadas.");
        const groups = new Map<string, { variant: OperationalReportModel["people"][number]["proposedVariants"][number]; people: Set<string>; dates: Set<string> }>();
        for (const person of people) for (const variant of person.proposedVariants) {
          const group = groups.get(variant.shiftId) ?? { variant, people: new Set<string>(), dates: new Set<string>() };
          group.people.add(person.employee.id); variant.dates.forEach(date => { group.dates.add(date); }); groups.set(variant.shiftId, group);
        }
        const rows = [...groups.values()].sort((a, b) => a.variant.schedule.localeCompare(b.variant.schedule) || a.variant.code.localeCompare(b.variant.code))
          .map(group => [group.variant.code, group.variant.schedule, group.variant.interval, group.variant.daily, String(group.people.size),
            group.dates.size ? [...group.dates].sort().map(date => date.slice(8) + "/" + date.slice(5, 7)).join(", ") : "Referência sem datas"]);
        table(["Variante", "WORK", "Pausas", "Jornada", "Pessoas com esta variante", "Datas com uso"], rows, [0.8, 2, 1.7, 0.8, 1, 2]);
      }
      if (section === "presence") {
        paragraph("WORK contínuo; pausa sem atendimento em cinza; pausa paga em azul claro. Relógio civil 00:00–24:00.");
        if (model.operations.days.some(day => day.sector === sector && day.date === model.options.date && day.status === "PARTIAL")) paragraph("Com horário: contagem conhecida. Registros ou relógios pendentes não são presença zero.");
        const plotX = margin + 240, plotWidth = available - 240;
        const axis = () => { for (let hour = 0; hour <= 24; hour += 4) text(String(hour).padStart(2, "0") + ":00", plotX + hour / 24 * (plotWidth - 28), y, 8); y -= 18; };
        axis();
        for (const row of model.presence.filter((row: OperationalPresenceRow) => row.sector === sector)) {
          const names = wrap(row.label + " | " + row.role, 225, 8.5), states = wrap(row.state, plotWidth - 28, 8);
          const rowHeight = Math.max(36, names.length * 12 + 8, row.segments.length ? 0 : states.length * 11 + 8);
          if (y - rowHeight < 45) { newPage(); axis(); }
          names.forEach((line, i) => { text(line, margin, y - i * 12, 8.5); });
          page.drawLine({ start: { x: plotX, y: y - 10 }, end: { x: plotX + plotWidth - 28, y: y - 10 }, thickness: 0.4, color: rgb(0.79, 0.83, 0.88) });
          for (const segment of row.segments) page.drawRectangle({ x: plotX + segment.start / 1440 * (plotWidth - 28), y: y - 16,
            width: (segment.end - segment.start) / 1440 * (plotWidth - 28), height: 12,
            color: segment.kind === "WORK" ? rgb(0.14, 0.23, 0.33) : segment.kind === "BREAK" ? rgb(0.78, 0.8, 0.82) : rgb(0.62, 0.73, 0.86) });
          if (!row.segments.length) for (const [i, line] of states.entries()) { text(line, plotX, y - i * 11, 8); }
          y -= rowHeight;
        }
        table(["Colaborador", "Segmentos exatos"], model.presence.filter((row: OperationalPresenceRow) => row.sector === sector).map(row => [row.label,
          row.segments.length ? row.segments.map(segment => `${segment.kind}: ${escalaDuration(segment.start)}-${escalaDuration(segment.end)}`).join(" | ") : row.state]), [1, 2]);
        table(["Faixa", "Com horário", "Em pausa", "Sem relógio / DUTY"], model.operations.days.filter(day => day.date === model.options.date && day.sector === sector)
          .flatMap(day => (day.windows ?? []).map(window => [`${escalaDuration(window.start)}-${escalaDuration(window.end)}`, String(window.counts.presentTimed), String(window.counts.pause), String(window.counts.workWithoutClock + window.counts.duty)])), [1.5, 1, 1, 1.2]);
      }
      if (section === "coverage") {
        paragraph("Referências independentes. Falta pode ser limitada por funções, além da quantidade de pessoas.");
        if (model.coverage) {
          const basis = model.coverage.context.basis;
          const states = { VALID: "válida", MISSING: "ausente", STALE: "desatualizada", NOT_REQUIRED: "sem referência estimada" };
          paragraph(`Origem: base ${basis.origin === "PERSISTED" ? "persistida" : "preparada"}, revisão ${model.revision}; ${states[basis.status]}.`);
        }
        const rows = coverageReportRows(model.coverage).filter(row => row.sector === sector);
        if (!rows.length) paragraph("Sem referência de cobertura disponível.");
        for (const row of rows) {
          const peak = row.peak;
          table(["Origem", "Dia / faixa", "Previstas com horário", "Referência", "Falta", "Duração", "Dias com falta", "Falta acumulada"], [[
            row.requiredPersonMinutes === 0 ? "Sem referência positiva" : row.label, peak ? `${escalaDateLabel(peak.date)}\n${escalaDuration(peak.start)}-${escalaDuration(peak.end)}` : "Sem ocorrência apurada",
            peak ? String(peak.presentTimed) : "—", peak ? String(peak.required) : "—", peak ? String(peak.missing) : row.status === "COVERED" ? "0" : "—",
            peak ? duration(peak.durationMinutes) : "—", row.daysWithGap === null ? "Não apurado" : String(row.daysWithGap), duration(row.deficitPersonMinutes),
          ]], [1.7, 1.5, 1, 1, 0.7, 0.9, 1, 1.2]);
          paragraph("Observado: " + coverageObservation(row) + ". Tempo com falta no período: " + duration(row.minutesWithGap) + ".");
          if (peak) {
            const scale = Math.max(1, peak.required, peak.presentTimed), barWidth = available - 170;
            if (y - 55 < 45) newPage();
            text("No pico: previstas", margin, y); page.drawRectangle({ x: margin + 140, y: y - 3, width: peak.presentTimed / scale * barWidth, height: 10, color: rgb(0.14, 0.23, 0.33) }); y -= 20;
            text("Referência", margin, y); page.drawRectangle({ x: margin + 140, y: y - 3, width: peak.required / scale * barWidth, height: 10, color: rgb(0.62, 0.73, 0.86) }); y -= 25;
          }
        }
      }
    }
  }
  if (!document.getPageCount()) { title = "Relatório operacional"; newPage(); paragraph("Nenhum setor selecionado com dados."); }
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Revisão ${model.revision} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Relatório operacional - ${model.options.month} - revisão ${model.revision}`);
  return document.save();
}
