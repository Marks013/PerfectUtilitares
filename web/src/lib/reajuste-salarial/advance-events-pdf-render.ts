import type PDFKit from "pdfkit";
import type { buildSalaryAdvanceSummary } from "./advance-events";
import type { SalaryAdvanceReport } from "./types";
import type { EventAdjustmentReport, EventAdjustmentResult } from "./event-adjustment-types";
import { formatCents, formatPercentageHundredThousandths } from "./money";
import { salaryAdvanceScopeLabel, salaryAdvancePercentageLabel } from "./pdf-scope-display";

type Summary = ReturnType<typeof buildSalaryAdvanceSummary>;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Fixed readable font, explicit wrapping and page continuation; no ellipsis or clipped identities. */
function table(doc: PDFKit.PDFDocument, report: SalaryAdvanceReport, title: string, labels: string[], weights: number[]) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = left;
  const columns = weights.map(weight => { const column = { x: cursor, width: width * weight / totalWeight }; cursor += column.width; return column; });
  let y = 0;
  let branch = "";
  let collaborator = "";
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
  function band(value: string, bold = true) {
    const textLines = lines(clean(value), width - 12, bold);
    for (const line of textLines) {
      if (y + 15 > bottom) page();
      doc.rect(left, y, width, 15).fillAndStroke("#e7efec", "#d7dfdc");
      font(bold).fillColor("#13231f").text(line, left + 6, y + 3, { width: width - 12, lineBreak: false });
      y += 15;
    }
  }
  function row(values: string[], bold = false, header = false) {
    const pending = values.map((value, index) => lines(value, columns[index].width - 10, bold || header));
    while (pending.some(value => value.length)) {
      if (y + 20 > bottom) page();
      const count = Math.max(1, Math.floor((bottom - y - 10) / 10));
      const portion = pending.map(value => value.splice(0, count));
      const height = Math.max(20, ...portion.map(value => value.length * 10 + 10));
      for (const [index, value] of portion.entries()) {
        const column = columns[index];
        doc.rect(column.x, y, column.width, height).fillAndStroke(header ? "#13231f" : "#f5f8f7", "#d7dfdc");
        for (const [lineIndex, line] of value.entries()) font(bold || header).fillColor(header ? "#ffffff" : "#17211e")
          .text(line, column.x + 5, y + 5 + lineIndex * 10, { width: column.width - 10, lineBreak: false, align: index > 1 ? "right" : "left" });
      }
      y += height;
      if (pending.some(value => value.length)) page();
    }
  }
  function page(first = false) {
    if (!first) doc.addPage();
    y = doc.page.margins.top;
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#13231f").text(title, left, y, { width, lineBreak: false });
    y += 27;
    font().fillColor("#17211e").text(`Competências: ${report.competencies.map(item => item.key.replace("-", "/")).join(", ")} | ${report.employeeCount} colaboradores`, left, y, { width, lineBreak: false });
    y += 20;
    font().text(salaryAdvanceScopeLabel(report), left, y, { width, lineBreak: false });
    y += 15;
    font().text(salaryAdvancePercentageLabel(report), left, y, { width, lineBreak: false });
    y += 20;
    row(labels, true, true);
    if (branch) band(`Filial: ${branch} (continuação)`);
    if (collaborator) band(`${collaborator} (continuação)`, false);
  }
  page(true);
  return { row, band, branch(value: string) { collaborator = ""; branch = clean(value); band(`Filial: ${branch}`); },
    employee(value: string) { collaborator = clean(value); band(collaborator, false); }, clearEmployee() { collaborator = ""; } };
}

function totals(summary: { advanceCents: bigint; bonusCents: bigint; sundayCents: bigint; totalCents: bigint }) {
  return [summary.advanceCents, summary.bonusCents, summary.sundayCents, summary.totalCents].map(formatCents);
}

export function drawSalaryAdvanceSummary(doc: PDFKit.PDFDocument, summary: Summary, report: SalaryAdvanceReport) {
  const layout = table(doc, report, "Antecipação Salarial — resumo consolidado", ["Cadastro", "Colaborador", "Antecipação", "Bônus 565", "Domingos 901", "Total a pagar"], [65, 330, 100, 90, 95, 110]);
  layout.band("Somente as diferenças dos eventos são somadas. Os valores já pagos nas folhas não são somados novamente.", false);
  for (const group of summary.groups) {
    layout.branch(group.branchAlias);
    for (const employee of group.employees) layout.row([employee.registration, clean(employee.employeeName), ...totals(employee)]);
    layout.row(["", "Subtotal da filial", ...totals(group)], true);
  }
  layout.row(["", "Total geral", ...totals({ advanceCents: summary.advanceTotalCents, bonusCents: summary.bonusTotalCents, sundayCents: summary.sundayTotalCents, totalCents: summary.grandTotalCents })], true);
}

function eventCell(event: EventAdjustmentResult, inPayroll: boolean, oldValue: string, newValue: string | null) {
  if (!inPayroll) return "Ausente na competência\nDiferença R$ 0,00";
  const values = [event.received ? `Pago ${formatCents(BigInt(event.paidCents))} | Qtd ${event.quantity ?? "—"}` : "Evento ausente | Qtd 0",
    `Unitário ${formatCents(BigInt(oldValue))} para ${newValue === null ? "não configurado" : formatCents(BigInt(newValue))}`];
  if (event.targetCents !== null) values.push(`Alvo ${formatCents(BigInt(event.targetCents))}`);
  values.push(`Diferença ${formatCents(BigInt(event.differenceCents))}`);
  if (event.exclusionReason) values.push(`Bloqueado: ${event.exclusionReason}`);
  return values.join("\n");
}

export function drawSalaryAdvanceEventDetail(doc: PDFKit.PDFDocument, summary: Summary, report: SalaryAdvanceReport, events: EventAdjustmentReport) {
  const layout = table(doc, report, "Antecipação Salarial — apuração detalhada", ["Competência", "INSS Proc", "%", "Antecipação", "Bônus 565", "Domingos 901", "Total mês"], [70, 85, 50, 90, 205, 205, 90]);
  const eventEmployees = new Map(events.employees.map(employee => [employee.registration.replace(/^0+(?=\d)/, ""), employee]));
  for (const [groupIndex, group] of report.groups.entries()) {
    layout.branch(group.branchAlias);
    for (const [employeeIndex, employee] of group.employees.entries()) {
      layout.employee(`Cadastro ${employee.registration} | ${employee.employeeName}`);
      const eventEmployee = eventEmployees.get(employee.registration.replace(/^0+(?=\d)/, ""));
      if (!eventEmployee) throw new Error("Resumo validado sem colaborador dos eventos.");
      for (const [index, competency] of report.competencies.entries()) {
        const month = eventEmployee.months[index];
        const rule = employee.advanceRulesByCompetency?.get(competency.key);
        const base = employee.basesByCompetency.get(competency.key);
        const advance = employee.adjustmentsByCompetency.get(competency.key) ?? 0n;
        const historical = events.settings.historicOverrides.find(item => item.competencyKey === competency.key) ?? events.settings;
        const note = rule?.exclusionReason ? `Bloqueado: ${rule.exclusionReason}` : !month.inPayroll ? "Ausente na competência" : rule && !rule.metadataKnown ? "Situação ou cargo não informados; conferir elegibilidade e percentual" : "";
        const appliedPercentage = rule?.percentageTenThousandths ?? (report.salaryScope === "drivers-forklift" ? report.driverPercentageTenThousandths : report.percentageBasisPoints * 100n);
        const percentage = rule?.scopeEligible === false || !month.inPayroll || appliedPercentage === undefined ? "—" : formatPercentageHundredThousandths(rule?.percentageHundredThousandths ?? appliedPercentage * 10n);
        layout.row([competency.key.replace("-", "/"), base == null ? "—" : formatCents(base), percentage,
          `${formatCents(advance)}${note ? `\n${note}` : ""}`,
          eventCell(month.bonus565, month.inPayroll, historical.bonusOldValueCents, events.settings.bonusNewValueCents),
          eventCell(month.indemnity901, month.inPayroll, historical.sundayOldValueCents, events.settings.sundayNewValueCents),
          formatCents(advance + BigInt(month.bonus565.differenceCents) + BigInt(month.indemnity901.differenceCents))]);
      }
      const sum = summary.groups[groupIndex].employees[employeeIndex];
      layout.row(["Subtotal colaborador", "", "", ...totals(sum)], true);
      layout.clearEmployee();
    }
    layout.row(["Subtotal filial", "", "", ...totals(summary.groups[groupIndex])], true);
  }
  layout.row(["Total geral", "", "", ...totals({ advanceCents: summary.advanceTotalCents, bonusCents: summary.bonusTotalCents, sundayCents: summary.sundayTotalCents, totalCents: summary.grandTotalCents })], true);
}
