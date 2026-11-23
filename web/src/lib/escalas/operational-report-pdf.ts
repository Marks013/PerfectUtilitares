import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EscalaError } from "./errors";
import { dayOfWeek } from "./dates";
import { rosterPdfColor } from "./roster-colors";
import { escalaDateLabel, escalaDuration } from "./presentation";
import { compareProposedSchedules, compareSectors } from "./order";
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
  const civilDate = (value: string) => value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(model.options.month + "-01T12:00:00Z"));
  const updatedDate = new Date(model.updatedAt);
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(model.updatedAt) ? civilDate(model.updatedAt)
    : Number.isNaN(updatedDate.getTime()) ? "não informada" : new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Sao_Paulo",
    }).format(updatedDate).replace(", ", " às ");
  const stateText = (value: string) => value.replace(/^Plantão \(PL\), sem horário informado$/, "Plantão sem horário definido")
    .replace(/^(?:ENC|NP) — /, "");
  const calendarCode = (code: string) => code === "ENC" ? "SH" : code === "NP" ? "P" : code;
  const regularCharacters = new Set(font.getCharacterSet()), boldCharacters = new Set(bold.getCharacterSet());
  const width = 842, height = 595, margin = 26, available = width - margin * 2;
  let page!: PDFPage;
  let y = 0, title = "";
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
    page = document.addPage([width, height]);
    const branchLines = wrap(model.branch, available - 20, 12, true);
    const metadata = wrap(`${month} | Revisão ${model.revision} | ${model.status} | Planejamento da equipe\nPeríodo: ${civilDate(model.period)} | Atualizado em ${updated} | Semana: ${model.planningWeekLabel}`, available - 20, 8);
    const bandHeight = branchLines.length * 16 + metadata.length * 12 + 12;
    page.drawRectangle({ x: margin, y: height - margin - bandHeight, width: available, height: bandHeight, color: rgb(0.12, 0.27, 0.4) });
    y = height - margin - 16;
    for (const line of branchLines) { page.drawText(clean(line), { x: margin + 10, y, size: 12, font: bold, color: rgb(1, 1, 1) }); y -= 16; }
    for (const line of metadata) { page.drawText(clean(line), { x: margin + 10, y, size: 8, font, color: rgb(1, 1, 1) }); y -= 12; }
    y -= 17;
    for (const line of wrap(title, available, 11, true)) { text(line, margin, y, 11, true); y -= 16; }
    y -= 5;
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
    const people = model.people;
    for (const section of model.options.sections) {
      title = section === "variants" ? "Horários por setor e cargo" : OPERATIONAL_REPORT_SECTION_LABELS[section];
      if (section === "presence") title += " | " + civilDate(model.options.date ?? "");
      newPage();
      if (model.referencesOnly) paragraph("Referências de horários, sem grade diária.");
      if (section === "summary") {
        paragraph("Cada colaborador é contado uma vez por dia, conforme sua situação na escala. Plantões e jornadas sem horário definido não entram no cálculo de presença por horário.");
        const days = model.operations.days;
        const total = (field: "workTimed" | "workWithoutClock" | "duty" | "off" | "absence" | "holiday" | "unassigned") => days.reduce((sum, day) => sum + day.counts[field], 0);
        paragraph(`Totais do mês: trabalho com horário ${total("workTimed")}; trabalho sem horário ${total("workWithoutClock")}; plantões ${total("duty")}; folgas ${total("off")}; afastamentos ${total("absence")}; feriados ${total("holiday")}; dias pendentes ${total("unassigned")}.`);
        paragraph(`Folgas aos sábados: ${days.filter(day => dayOfWeek(day.date) === 5).reduce((sum, day) => sum + day.counts.off, 0)}; folgas aos domingos: ${days.filter(day => dayOfWeek(day.date) === 6).reduce((sum, day) => sum + day.counts.off, 0)}.`);
        table(["Dia / setor", "Com horário", "Sem horário", "Plantão", "Folga", "Afastamento", "Feriado", "Pendente", "Tempo de trabalho"], days.map(day => [
          escalaDateLabel(day.date) + "\n" + day.sector, String(day.counts.workTimed), String(day.counts.workWithoutClock), String(day.counts.duty), String(day.counts.off),
          String(day.counts.absence), String(day.counts.holiday), String(day.counts.unassigned), day.workPersonMinutes === null ? "Não apurado; conhecido: " + duration(day.knownWorkPersonMinutes) : duration(day.workPersonMinutes),
        ]), [1.2, 1, 1, 0.7, 0.7, 0.7, 1, 1, 1.2]);
        const excluded = model.excluded;
        if (excluded.length) paragraph(`Não incluídos: ${excluded.length}. Relação separada da equipe prevista.`);
        if (days.some(day => day.status === "PARTIAL")) paragraph("Dados com lacunas: horas totais não apuradas; os estados conhecidos foram preservados.");
      }
      if (section === "calendar") {
        const calendarPeople = people.filter(person => person.employee.planningEnabled !== false);
        const weeks = model.calendar.weeks;
        const identityWidth = 220, totalsWidth = 102, totalWidth = totalsWidth / 3, cellSize = 7.4;
        const byEmployee = new Map(model.calendar.people.map(row => [row.employeeId, row]));
        const largestCode = Math.max(0, ...model.calendar.people.flatMap(person => person.cells.map(cell => font.widthOfTextAtSize(clean(cell.code), cellSize))));
        const fullMonthFits = largestCode <= (available - identityWidth - totalsWidth) / model.dates.length - 2;
        const blocks = fullMonthFits ? [model.dates] : Array.from({ length: Math.ceil(weeks.length / 3) }, (_, i) =>
          weeks.slice(i * 3, i * 3 + 3).flatMap(week => week.dates));
        const colors = { FF: rgb(0.84, 0.92, 0.97), FM: rgb(0.99, 0.89, 0.79), PL: rgb(0.91, 0.88, 0.97) };
        for (const [i, dates] of blocks.entries()) {
          if (i) newPage();
          const dayWidth = (available - identityWidth - totalsWidth) / dates.length;
          const dateSize = Math.min(7.2, ...dates.map(date => (dayWidth - 2.2) / bold.widthOfTextAtSize(escalaDateLabel(date).split(" ")[1], 1)));
          const cell = (value: string, x: number, top: number, measure: number, rowHeight: number, fill = rgb(1, 1, 1), size = cellSize, strong = false, centered = true) => {
            page.drawRectangle({ x, y: top - rowHeight, width: measure, height: rowHeight, color: fill, borderColor: rgb(0.76, 0.82, 0.87), borderWidth: 0.35 });
            wrap(value, measure - (centered ? 2 : 6), size, strong).forEach((line, index) => { text(line, centered ? x + (measure - (strong ? bold : font).widthOfTextAtSize(line, size)) / 2 : x + 3, top - 11 - index * 10, size, strong); });
          };
          const header = () => {
            paragraph("FF = folga fixa configurada; FM = folga móvel; AF = afastamento (férias ou outro motivo não informado).", 8);
            paragraph("FE = feriado fechado; PL = plantão; SH = sem horário definido; P = dia pendente; FV = fora do vínculo; T01... = horários da escala.", 8);
            const includedDates = new Set(dates);
            const weekStarts = weeks.filter(week => week.dates.some(date => includedDates.has(date))).map(week => civilDate(week.start).slice(0, 5));
            paragraph(`Semanas iniciadas em ${weekStarts.join(", ")} | Domingos destacados no cabeçalho | Totais do mês no recorte`, 8);
            const top = y, fill = rgb(0.88, 0.93, 0.97);
            cell("Setor", margin, top, 58, 42, fill, 8, true);
            cell("Matrícula / nome\nCargo / folga fixa", margin + 58, top, identityWidth - 58, 42, fill, 8, true, false);
            for (const [index, week] of weeks.entries()) {
              const included = week.dates.filter(date => includedDates.has(date));
              if (!included.length) continue;
              const x = margin + identityWidth + dates.indexOf(included[0]) * dayWidth;
              const weekWidth = included.length * dayWidth, number = index + 1;
              cell(weekWidth < 60 ? `S${number}` : `Semana ${number}`, x, top, weekWidth, 18, fill, 8, true);
            }
            dates.forEach((date, index) => {
              const x = margin + identityWidth + index * dayWidth;
              cell(date.slice(8) + "\n" + escalaDateLabel(date).split(" ")[1], x, top - 18, dayWidth, 24, fill, dateSize, true);
              if (dayOfWeek(date) === 6) page.drawRectangle({ x, y: top - 20, width: dayWidth, height: 2, color: rgb(0.14, 0.23, 0.33) });
            });
            ["Dom. de\nfolga", "Sáb. de\nfolga", "Dias de\ntrabalho"].forEach((label, index) => { cell(label, margin + available - totalsWidth + index * totalWidth, top, totalWidth, 42, fill, 7, true); });
            y -= 42;
          };
          const footer = () => {
            const totals = new Map(model.calendar.days.map(day => [day.date, day]));
            for (const [index, label] of ["Trabalhando, incluindo plantões", "Folgas no dia"].entries()) {
              cell(label, margin, y, identityWidth, 15, rgb(0.93, 0.96, 0.98), 7.6, true, false);
              dates.forEach((date, j) => {
                const total = index === 0 ? totals.get(date)?.working : totals.get(date)?.off;
                cell(total === null || total === undefined ? "?" : String(total), margin + identityWidth + j * dayWidth, y, dayWidth, 15, rgb(0.93, 0.96, 0.98));
              });
              y -= 15;
            }
            y -= 11;
            text("Totais do recorte selecionado. ? = total diário pendente; + = total individual incompleto. Esta escala não substitui o registro de ponto.", margin, y, 7.5); y -= 11;
            text("Mínimo e saldo diários não apurados. A comparação disponível considera a equipe necessária em cada horário.", margin, y, 7.5); y -= 14;
          };
          header();
          for (const person of calendarPeople) {
            const row = byEmployee.get(person.employee.id);
            if (!row) throw new EscalaError(422, "ESCALA_OPERATIONAL_MODEL_INVALID", "A composição do relatório está incompleta. Os dados foram mantidos.");
            const fixed = row.fixedOffDays.map(day => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ") || "não configurada";
            const identity = wrap(`${person.employee.registration} - ${person.employee.name}\n${person.employee.role}\nFixa: ${fixed}`, identityWidth - 64, 8);
            const sectorLines = wrap(person.employee.sector, 52, 7.4);
            const lines = Math.max(identity.length, sectorLines.length); let offset = 0;
            while (offset < lines) {
              if (y < 125 || (offset === 0 && lines * 10 + 8 < 250 && y - Math.max(30, lines * 10 + 8) < 90)) { footer(); newPage(); header(); }
              const remaining = Math.floor((y - 100) / 10), count = Math.min(lines - offset, Math.max(1, remaining));
              const rowHeight = Math.max(30, count * 10 + 8);
              if (rowHeight > y - 90) { footer(); newPage(); header(); continue; }
              cell(sectorLines.slice(offset, offset + count).join("\n"), margin, y, 58, rowHeight, rgb(1, 1, 1), 7.4, false, false);
              cell(identity.slice(offset, offset + count).join("\n"), margin + 58, y, identityWidth - 58, rowHeight, rgb(1, 1, 1), 8, false, false);
              dates.forEach((date, j) => {
                const code = row.cells.find(day => day.date === date)?.code ?? "NP";
                const fill = colors[code as keyof typeof colors] ?? rgb(...rosterPdfColor(code));
                cell(calendarCode(code), margin + identityWidth + j * dayWidth, y, dayWidth, rowHeight, fill);
              });
              [row.totals.sundayOff, row.totals.saturdayOff, row.totals.worked].forEach((total, j) => {
                const unknown = [row.totals.unknownSundays, row.totals.unknownSaturdays, row.totals.unassigned][j];
                cell(String(total) + (unknown ? "+" : ""), margin + available - totalsWidth + j * totalWidth, y, totalWidth, rowHeight, rgb(0.97, 0.98, 0.99), 8, true);
              });
              y -= rowHeight; offset += count;
              if (offset < lines) { footer(); newPage(); header(); }
            }
          }
          footer();
        }
      }
      if (section === "journeys") {
        paragraph("Horários previstos para cada colaborador. Quando houver mais de um horário, todos são apresentados.");
        const rows = people.flatMap(person => person.proposedVariants.length ? person.proposedVariants.map(variant => [
          `${person.employee.registration} - ${person.employee.name}\n${person.employee.role}\nSetor: ${person.employee.sector}`, variant.code, variant.schedule, variant.interval, variant.daily,
          variant.dates.length ? variant.dates.map(date => date.slice(8) + "/" + date.slice(5, 7)).join(", ") : "Referência sem datas",
        ]) : [[`${person.employee.registration} - ${person.employee.name}\n${person.employee.role}\nSetor: ${person.employee.sector}`, "—", stateText(person.proposedSchedule), "Não se aplica", "Não apurada", model.referencesOnly ? "Sem datas" : "Sem trabalho com horário definido"]]);
        table(["Colaborador", "Turno", "Horários", "Intervalos", "Jornada", "Dias previstos"], rows, [2.2, 0.7, 2.3, 1.8, 0.8, 1.8]);
      }
      if (section === "variants") {
        paragraph("Cada linha reúne colaboradores do mesmo setor, cargo e horário. Uma pessoa pode aparecer em mais de um horário; os totais não devem ser somados. Confira os dias de cada colaborador na seção de jornadas.");
        const groups = new Map<string, { sector: string; role: string; variant: OperationalReportModel["people"][number]["proposedVariants"][number]; people: Set<string>; dates: Set<string> }>();
        for (const person of people) for (const variant of person.proposedVariants) {
          const key = person.employee.sector + "\0" + person.employee.role + "\0" + variant.shiftId;
          const group = groups.get(key) ?? { sector: person.employee.sector, role: person.employee.role, variant, people: new Set<string>(), dates: new Set<string>() };
          group.people.add(person.employee.id); variant.dates.forEach(date => { group.dates.add(date); }); groups.set(key, group);
        }
        const rows = [...groups.values()].sort((a, b) => compareSectors(a.sector, b.sector) || compareSectors(a.role, b.role)
          || compareProposedSchedules(a.variant.schedule, b.variant.schedule) || a.variant.code.localeCompare(b.variant.code))
          .map(group => [group.sector + "\n" + group.role + "\n" + group.variant.code, group.variant.schedule, group.variant.interval, group.variant.daily, String(group.people.size),
            group.dates.size ? [...group.dates].sort().map(date => date.slice(8) + "/" + date.slice(5, 7)).join(", ") : "Referência sem datas"]);
        table(["Setor / cargo / turno", "Horários", "Intervalos", "Jornada", "Colaboradores", "Dias previstos"], rows, [1.2, 2, 1.7, 0.8, 1, 2]);
      }
      if (section === "presence") {
        paragraph("Azul escuro: trabalhando; cinza: intervalo; azul claro: pausa remunerada. Nenhuma pausa conta como presença. O mapa mostra o período de 00:00 a 24:00.");
        const day = model.calendar.days.find(day => day.date === model.options.date);
        if (day) paragraph(`Colaboradores previstos: ${day.working ?? `total pendente (${day.knownWorking} já definidos)`}; plantões: ${day.duty}; sem horário definido: ${day.withoutClock}; folgas: ${day.off ?? `total pendente (${day.knownOff} já definidas)`}; afastamentos: ${day.absence}; feriados fechados: ${day.holiday}; dias pendentes: ${day.unassigned}.`);
        if (model.operations.days.some(day => day.date === model.options.date && day.status === "PARTIAL")) paragraph("Com horário: contagem conhecida. Registros ou relógios pendentes não são presença zero.");
        const plotX = margin + 240, plotWidth = available - 240;
        const axis = () => {
          text("Matrícula / nome / cargo / setor", margin, y, 8, true);
          for (let hour = 0; hour <= 24; hour += 2) text(String(hour).padStart(2, "0") + ":00", plotX + hour / 24 * (plotWidth - 28) - 9, y, 7);
          y -= 18;
        };
        axis();
        for (const row of model.presence) {
          const names = wrap(row.label + "\n" + row.role + " | " + row.sector, 225, 8.5), states = wrap(stateText(row.state), plotWidth - 28, 8);
          const rowHeight = Math.max(36, names.length * 12 + 8, row.segments.length ? 0 : states.length * 11 + 8);
          if (y - rowHeight < 45) { newPage(); axis(); }
          names.forEach((line, i) => { text(line, margin, y - i * 12, 8.5); });
          for (let hour = 0; hour <= 24; hour++) page.drawLine({ start: { x: plotX + hour / 24 * (plotWidth - 28), y: y - 20 }, end: { x: plotX + hour / 24 * (plotWidth - 28), y: y + 3 }, thickness: 0.3, color: rgb(0.86, 0.89, 0.92) });
          page.drawLine({ start: { x: plotX, y: y - 10 }, end: { x: plotX + plotWidth - 28, y: y - 10 }, thickness: 0.4, color: rgb(0.79, 0.83, 0.88) });
          for (const segment of row.segments) page.drawRectangle({ x: plotX + segment.start / 1440 * (plotWidth - 28), y: y - 16,
            width: (segment.end - segment.start) / 1440 * (plotWidth - 28), height: 12,
            color: segment.kind === "WORK" ? rgb(0.14, 0.23, 0.33) : segment.kind === "BREAK" ? rgb(0.78, 0.8, 0.82) : rgb(0.62, 0.73, 0.86) });
          if (!row.segments.length) for (const [i, line] of states.entries()) { text(line, plotX, y - i * 11, 8); }
          y -= rowHeight;
        }
        paragraph("Entradas, saídas e intervalos previstos para o dia. Todos os períodos de trabalho são apresentados.", 8);
        table(["Colaborador / setor", "Entradas e saídas", "Intervalos / pausas", "Tempo de trabalho"], model.presence.map((row: OperationalPresenceRow) => [row.label + "\n" + row.role + " | " + row.sector,
          row.segments.some(segment => segment.kind === "WORK") ? row.segments.filter(segment => segment.kind === "WORK").map(segment => `${escalaDuration(segment.start)}-${escalaDuration(segment.end)}`).join(" / ") : stateText(row.state),
          row.segments.filter(segment => segment.kind !== "WORK").map(segment => `${escalaDuration(segment.start)}-${escalaDuration(segment.end)}${segment.kind === "PAID_BREAK" ? " (remunerada; sem atendimento)" : ""}`).join(" / ") || "Sem pausa observada no recorte",
          row.segments.length ? duration(row.segments.reduce((sum, segment) => sum + (segment.kind === "WORK" ? segment.end - segment.start : 0), 0)) : "Não apurado"]), [2.2, 2.2, 2, 0.9]);
        const totalMinutes = model.presenceWindows.reduce((sum, window) => sum + window.present * (window.end - window.start), 0);
        paragraph(`Tempo de trabalho previsto: ${duration(totalMinutes)} de equipe, somando os colaboradores com horário definido. Plantões e jornadas sem horário não entram nesse total.`);
        table(["Horário", "Colaboradores trabalhando", "Em intervalo ou pausa"], model.presenceWindows.map(window => [
          `${escalaDuration(window.start)}-${escalaDuration(window.end)}`, String(window.present), String(window.pause)]), [1.5, 1, 1.5]);
      }
      if (section === "coverage") {
        paragraph(`Comparação simultânea por faixa e setor, revisão ${model.revision}. Mínimo informado e referência estimada permanecem separados.`);
        if (model.coverage) {
          const basis = model.coverage.context.basis;
          const states = { VALID: "válida", MISSING: "ausente", STALE: "desatualizada", NOT_REQUIRED: "sem referência estimada" };
          paragraph(`Referência de cobertura ${basis.origin === "PERSISTED" ? "da escala salva" : "do planejamento"}, revisão ${model.revision}: ${states[basis.status]}.`);
        }
        const rows = coverageReportRows(model.coverage);
        if (!rows.length) paragraph("Sem referência de cobertura disponível.");
        for (const row of rows) {
          const peak = row.peak;
          table(["Referência", "Data / faixa do pico", "Escalados na faixa", "Referência na faixa", "Maior falta simultânea", "Duração do pico", "Dias com falta em algum horário", "Horas de equipe em falta no mês"], [[
            row.sector + "\n" + (row.requiredPersonMinutes === 0 ? "Sem referência positiva" : row.label), peak ? `${escalaDateLabel(peak.date)}\n${escalaDuration(peak.start)}-${escalaDuration(peak.end)}` : "Sem ocorrência apurada",
            peak ? String(peak.presentTimed) : "—", peak ? String(peak.required) : "—", peak ? String(peak.missing) : row.status === "COVERED" ? "0" : "—",
            peak ? duration(peak.durationMinutes) : "—", row.daysWithGap === null ? "Não apurado" : String(row.daysWithGap), duration(row.deficitPersonMinutes),
          ]], [1.7, 1.5, 1, 1, 0.7, 0.9, 1, 1.2]);
          paragraph("Na faixa do pico: " + coverageObservation(row).replace("Pausa:", "Intervalo:").replace("OFF:", "Folga:").replace("Sem relógio:", "Sem horário definido:") + ". Duração somada das faixas com falta: " + duration(row.minutesWithGap) + ".");
          if (peak) {
            const scale = Math.max(1, peak.required, peak.presentTimed), barWidth = available - 170;
            if (y - 55 < 45) newPage();
            text("Escalados na faixa", margin, y); page.drawRectangle({ x: margin + 140, y: y - 3, width: peak.presentTimed / scale * barWidth, height: 10, color: rgb(0.14, 0.23, 0.33) }); y -= 20;
            text("Referência", margin, y); page.drawRectangle({ x: margin + 140, y: y - 3, width: peak.required / scale * barWidth, height: 10, color: rgb(0.62, 0.73, 0.86) }); y -= 25;
          }
        }
      }
    }
  if (!document.getPageCount()) { title = "Relatório operacional"; newPage(); paragraph("Nenhum setor selecionado com dados."); }
  const pages = document.getPages();
  pages.forEach((item, index) => { item.drawText(`PerfectUtilitares | Revisão ${model.revision} | ${index + 1}/${pages.length}`, { x: margin, y: 16, size: 8, font }); });
  document.setTitle(`Relatório operacional - ${month} - revisão ${model.revision}`);
  return document.save();
}
