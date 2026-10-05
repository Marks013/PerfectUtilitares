import type PDFKit from "pdfkit";
import type { buildSalaryAdvanceSummary } from "./advance-events";
import type { SalaryAdvanceReport } from "./types";
import type { EventAdjustmentReport, EventAdjustmentResult } from "./event-adjustment-types";
import { formatCents, formatPercentageHundredThousandths } from "./money";
import { salaryAdvanceScopeLabel, salaryAdvancePercentageLabel } from "./pdf-scope-display";

type Summary = ReturnType<typeof buildSalaryAdvanceSummary>;
type Cell = { value: string; span?: number };
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const amount = (value: bigint) => formatCents(value).replace(/^R\$\s*/, "");
const LINE_HEIGHT = 9;
const PADDING = 3;
const MIN_HEIGHT = 15;

function settingsLines(events?: EventAdjustmentReport) {
  if (!events) return [];
  const unit = (old: string, next: string | null) => `${formatCents(BigInt(old))} para ${next === null ? "não configurado" : formatCents(BigInt(next))}`;
  return [
    `Valores unitários — Bônus 565: ${unit(events.settings.bonusOldValueCents, events.settings.bonusNewValueCents)} | Domingos 901: ${unit(events.settings.sundayOldValueCents, events.settings.sundayNewValueCents)}`,
    ...events.settings.historicOverrides.map(item => `Histórico ${item.competencyKey.replace("-", "/")} — Bônus 565: ${unit(item.bonusOldValueCents, events.settings.bonusNewValueCents)} | Domingos 901: ${unit(item.sundayOldValueCents, events.settings.sundayNewValueCents)}`),
  ];
}

/** Fixed body type; measure before paging so ordinary rows and employee blocks stay intact. */
function table(doc: PDFKit.PDFDocument, report: SalaryAdvanceReport, title: string, labels: string[], weights: number[], configuration: string[], headerGroups?: Cell[]) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = left;
  const columns = weights.map(weight => { const column = { x: cursor, width: width * weight / totalWeight }; cursor += column.width; return column; });
  let y = 0;
  let bodyTop = 0;
  let branch = "";
  let collaborator = "";
  let striped = false;
  const font = (bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
  function lines(value: string, available: number, bold = false) {
    font(bold);
    return value.split("\n").flatMap(paragraph => {
      const output: string[] = [];
      let current = "";
      for (const word of paragraph.split(" ")) {
        const candidate = current ? `${current} ${word}` : word;
        if (doc.widthOfString(candidate) <= available) { current = candidate; continue; }
        if (current) { output.push(current); current = ""; }
        for (const character of word) {
          if (current && doc.widthOfString(current + character) > available) { output.push(current); current = ""; }
          current += character;
        }
      }
      output.push(current);
      return output;
    });
  }
  function measure(values: Cell[], bold = false) {
    let index = 0;
    return values.map(({ value, span = 1 }) => {
      const x = columns[index].x;
      const cellWidth = columns.slice(index, index + span).reduce((sum, column) => sum + column.width, 0);
      const cell = { x, width: cellWidth, index, pending: lines(value, cellWidth - PADDING * 2, bold) };
      index += span;
      return cell;
    });
  }
  function height(values: Cell[], bold = false) {
    return Math.max(MIN_HEIGHT, ...measure(values, bold).map(cell => cell.pending.length * LINE_HEIGHT + PADDING * 2));
  }
  function keep(required: number) {
    if (y + required > bottom && required <= bottom - bodyTop) page();
  }
  function row(values: Cell[], bold = false, header = false) {
    keep(height(values, bold || header));
    const cells = measure(values, bold || header);
    while (cells.some(cell => cell.pending.length)) {
      if (y + MIN_HEIGHT > bottom) page();
      const count = Math.max(1, Math.floor((bottom - y - PADDING * 2) / LINE_HEIGHT));
      const portion = cells.map(cell => ({ ...cell, text: cell.pending.splice(0, count) }));
      const rowHeight = Math.max(MIN_HEIGHT, ...portion.map(cell => cell.text.length * LINE_HEIGHT + PADDING * 2));
      for (const cell of portion) {
        doc.rect(cell.x, y, cell.width, rowHeight).fillAndStroke(header ? "#13231f" : bold ? "#e7efec" : striped ? "#f5f8f7" : "#ffffff", "#d7dfdc");
        for (const [lineIndex, line] of cell.text.entries()) font(bold || header).fillColor(header ? "#ffffff" : "#17211e")
          .text(line, cell.x + PADDING, y + PADDING + lineIndex * LINE_HEIGHT, { width: cell.width - PADDING * 2, lineBreak: false, align: header ? "center" : cell.index === 0 || (!headerGroups && cell.index === 1) ? "left" : "right" });
      }
      y += rowHeight;
      if (cells.some(cell => cell.pending.length)) page();
    }
    if (!header && !bold) striped = !striped;
  }
  function band(value: string, bold = true) {
    row([{ value: clean(value), span: columns.length }], bold);
  }
  function info(value: string) {
    for (const line of lines(clean(value), width)) {
      font().fillColor("#17211e").text(line, left, y, { width, lineBreak: false });
      y += 12;
    }
  }
  function page(first = false) {
    if (!first) doc.addPage();
    y = doc.page.margins.top;
    doc.font("Helvetica-Bold").fontSize(first ? 15 : 11).fillColor("#13231f").text(title, left, y, { width, lineBreak: false });
    y += first ? 23 : 18;
    info(`Competências: ${report.competencies.map(item => item.key.replace("-", "/")).join(", ")} | ${report.employeeCount} colaboradores`);
    if (first) {
      info(salaryAdvanceScopeLabel(report));
      info(salaryAdvancePercentageLabel(report));
      if (report.excludeAbsentLatest) info(`Filtro de presença: somente colaboradores com base em ${report.competencies.at(-1)?.key.replace("-", "/")}.`);
      for (const value of configuration) info(value);
      y += 4;
    }
    bodyTop = y;
    if (headerGroups) row(headerGroups, true, true);
    row(labels.map(value => ({ value })), true, true);
    if (branch) band(`Filial: ${branch} (continuação)`);
    if (collaborator) band(`${collaborator} (continuação)`, false);
    bodyTop = y;
  }
  page(true);
  return { row, height, keep,
    branch(value: string, nextHeight: number) {
      const nextBranch = branch !== "";
      collaborator = "";
      branch = "";
      const label = clean(value);
      if (nextBranch) page();
      else keep(height([{ value: `Filial: ${label}`, span: columns.length }], true) + nextHeight);
      branch = label;
      band(`Filial: ${branch}`);
    },
    employee(value: string, rows: Cell[][], extraHeight = 0) {
      collaborator = "";
      const label = clean(value);
      keep(height([{ value: label, span: columns.length }]) + rows.reduce((sum, cells) => sum + height(cells), 0) + extraHeight);
      collaborator = label;
      band(collaborator, false);
    },
    clearEmployee() { collaborator = ""; },
  };
}

function totals(summary: { advanceCents: bigint; bonusCents: bigint; sundayCents: bigint; totalCents: bigint }) {
  return [summary.advanceCents, summary.bonusCents, summary.sundayCents, summary.totalCents];
}

export function drawSalaryAdvanceSummary(doc: PDFKit.PDFDocument, summary: Summary, report: SalaryAdvanceReport, events?: EventAdjustmentReport) {
  const layout = table(doc, report, "Antecipação Salarial — resumo consolidado", ["Cadastro", "Colaborador", "Antecipação", "Bônus 565", "Domingos 901", "Total a pagar"], [65, 330, 100, 90, 95, 110], [...settingsLines(events), "Somente as diferenças dos eventos são somadas. Os valores já pagos nas folhas não são somados novamente."]);
  const sumCells = (label: string, values: bigint[]) => [{ value: "" }, { value: label }, ...values.map(value => ({ value: formatCents(value) }))];
  for (const group of summary.groups) {
    const rows = group.employees.map(employee => [employee.registration, clean(employee.employeeName), ...totals(employee).map(formatCents)].map(value => ({ value })));
    const subtotal = sumCells("Subtotal da filial", totals(group));
    layout.branch(group.branchAlias, layout.height(rows[0]) + (rows.length === 1 ? layout.height(subtotal, true) : 0));
    for (const [index, cells] of rows.entries()) {
      if (index === rows.length - 1) layout.keep(layout.height(cells) + layout.height(subtotal, true));
      layout.row(cells);
    }
    layout.row(subtotal, true);
  }
  layout.row(sumCells("Total geral", [summary.advanceTotalCents, summary.bonusTotalCents, summary.sundayTotalCents, summary.grandTotalCents]), true);
}

function eventCells(event: EventAdjustmentResult, inPayroll: boolean): Cell[] {
  return [inPayroll ? event.received ? amount(BigInt(event.paidCents)) : "Sem evento" : "—", inPayroll ? String(event.quantity ?? "—") : "—", amount(BigInt(event.differenceCents))].map(value => ({ value }));
}

export function drawSalaryAdvanceEventDetail(doc: PDFKit.PDFDocument, summary: Summary, report: SalaryAdvanceReport, events: EventAdjustmentReport) {
  const layout = table(doc, report, "Antecipação Salarial — apuração detalhada", ["Competência", "INSS Proc (R$)", "%", "Valor (R$)", "Pago (R$)", "Qtd", "Dif. (R$)", "Pago (R$)", "Qtd", "Dif. (R$)", "Total mês (R$)"], [64, 90, 54, 80, 75, 28, 75, 75, 28, 75, 90], [...settingsLines(events), "Pago = valor original na folha | Qtd = quantidade apurada | Dif. = diferença a pagar. Bloqueios e ausências são indicados abaixo do mês."], [{ value: "Bases e antecipação", span: 4 }, { value: "Bônus 565", span: 3 }, { value: "Domingos 901", span: 3 }, { value: "Total mês" }]);
  const sumCells = (label: string, values: bigint[]): Cell[] => [{ value: label, span: 3 }, ...values.map((value, index) => ({ value: amount(value), span: index === 1 || index === 2 ? 3 : 1 }))];
  const eventEmployees = new Map(events.employees.map(employee => [employee.registration.replace(/^0+(?=\d)/, ""), employee]));
  for (const [groupIndex, group] of report.groups.entries()) {
    layout.branch(group.branchAlias, MIN_HEIGHT * 2);
    for (const [employeeIndex, employee] of group.employees.entries()) {
      const eventEmployee = eventEmployees.get(employee.registration.replace(/^0+(?=\d)/, ""));
      if (!eventEmployee) throw new Error("Resumo validado sem colaborador dos eventos.");
      const rows: Cell[][] = [];
      for (const [index, competency] of report.competencies.entries()) {
        const month = eventEmployee.months[index];
        const rule = employee.advanceRulesByCompetency?.get(competency.key);
        const base = employee.basesByCompetency.get(competency.key);
        const advance = employee.adjustmentsByCompetency.get(competency.key) ?? 0n;
        const reasons = [...new Set([rule?.exclusionReason, month.bonus565.exclusionReason, month.indemnity901.exclusionReason].filter(Boolean))];
        const note = reasons.length ? `Bloqueado: ${reasons.join(" | ")}` : !month.inPayroll ? "Ausente na competência" : rule && !rule.metadataKnown ? "Situação ou cargo não informados; conferir elegibilidade e percentual" : "";
        const appliedPercentage = rule?.percentageTenThousandths ?? (report.salaryScope === "drivers-forklift" ? report.driverPercentageTenThousandths : report.percentageBasisPoints * 100n);
        const percentage = rule?.scopeEligible === false || !month.inPayroll || appliedPercentage === undefined ? "—" : formatPercentageHundredThousandths(rule?.percentageHundredThousandths ?? appliedPercentage * 10n);
        rows.push([{ value: competency.key.replace("-", "/") }, { value: base == null ? "—" : amount(base) }, { value: percentage }, { value: amount(advance) }, ...eventCells(month.bonus565, month.inPayroll), ...eventCells(month.indemnity901, month.inPayroll), { value: amount(advance + BigInt(month.bonus565.differenceCents) + BigInt(month.indemnity901.differenceCents)) }]);
        if (note) rows.push([{ value: `${competency.key.replace("-", "/")} — ${note}`, span: 11 }]);
      }
      const subtotal = sumCells("Subtotal colaborador", totals(summary.groups[groupIndex].employees[employeeIndex]));
      rows.push(subtotal);
      const last = employeeIndex === group.employees.length - 1;
      layout.employee(`Cadastro ${employee.registration} | ${employee.employeeName}`, rows, last ? MIN_HEIGHT : 0);
      for (const cells of rows) layout.row(cells, cells === subtotal);
      layout.clearEmployee();
    }
    layout.row(sumCells("Subtotal filial", totals(summary.groups[groupIndex])), true);
  }
  layout.row(sumCells("Total geral", [summary.advanceTotalCents, summary.bonusTotalCents, summary.sundayTotalCents, summary.grandTotalCents]), true);
}
