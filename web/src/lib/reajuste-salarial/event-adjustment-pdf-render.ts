import type PDFKit from "pdfkit";
import type { EventAdjustmentEmployee, EventAdjustmentReport, EventAdjustmentResult } from "./event-adjustment-types";
import { formatCents } from "./money";
import { hasVerticalSpace } from "./pdf-layout";

const COLORS = { brand: "#13231f", ink: "#17211e", muted: "#64748b", border: "#d7dfdc", stripe: "#f5f8f7" };
const LABELS = ["Competência", "Evento", "Situação", "Pago", "Unitário histórico", "Quantidade", "Fonte da quantidade", "Novo unitário", "Novo total", "Adicional a pagar"];
const WEIGHTS = [60, 55, 115, 72, 70, 55, 70, 70, 78, 78];
const money = (value: string | null) => value === null ? "Não reajustado" : formatCents(BigInt(value));
const competencyLabel = (month: number, year: number) => `${String(month).padStart(2, "0")}/${year}`;

export function drawEventAdjustmentReport(doc: PDFKit.PDFDocument, report: EventAdjustmentReport) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const totalWeight = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const columns = WEIGHTS.map((weight, index) => ({
    x: left + WEIGHTS.slice(0, index).reduce((sum, item) => sum + item, 0) / totalWeight * width,
    width: weight / totalWeight * width,
  }));
  const generated = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(new Date(report.generatedAt));
  let y = 0;
  let activeEmployee: EventAdjustmentEmployee | null = null;
  let details = false;

  function textHeight(value: string, availableWidth = width, size = 8, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    return Math.ceil(doc.heightOfString(value, { width: availableWidth, lineGap: 0 }));
  }

  function text(value: string, top: number, size = 8, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(COLORS.ink)
      .text(value, left, top, { width, lineGap: 0 });
  }

  function row(values: string[], header = false) {
    const size = header ? 7 : 7.5;
    const height = Math.max(24, ...values.map((value, index) => textHeight(value, columns[index].width - 8, size, header) + 8));
    for (const [index, value] of values.entries()) {
      const column = columns[index];
      doc.rect(column.x, y, column.width, height).fillAndStroke(header ? COLORS.brand : COLORS.stripe, COLORS.border);
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(header ? "#ffffff" : COLORS.ink)
        .text(value, column.x + 4, y + 4, { width: column.width - 8, lineGap: 0, align: index >= 3 && index !== 6 ? "right" : "left" });
    }
    y += height;
  }

  function identity(employee: EventAdjustmentEmployee, continued = false) {
    const label = `Filial: ${employee.branchAlias} | Cadastro: ${employee.registration} | ${employee.employeeName}${continued ? " (continuação)" : ""}`.replace(/\s+/g, " ");
    const height = textHeight(label, width - 12, 9, true) + 12;
    doc.rect(left, y, width, height).fill("#e7efec");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.brand)
      .text(label, left + 6, y + 6, { width: width - 12, lineGap: 0 });
    y += height;
  }

  function page(newPage = false) {
    if (newPage) doc.addPage();
    y = doc.page.margins.top;
    text("Apuração de diferenças — eventos 565 e 901", y, 14, true);
    y += 23;
    text(`Gerado em ${generated} | ${report.employeeCount} colaboradores | ${report.branchCount} filiais`, y, 8);
    y += 18;
    if (details) {
      row(LABELS, true);
      if (activeEmployee) identity(activeEmployee, true);
    }
  }

  function ensure(height: number) {
    if (!hasVerticalSpace(y, height, bottom)) page(true);
  }

  function paragraph(value: string, bold = false) {
    value = value.replace(/\s+/g, " ").trim();
    const height = textHeight(value, width, 8, bold) + 7;
    ensure(height);
    text(value, y, 8, bold);
    y += height;
  }

  page();
  paragraph("565 — Bonus Convenc. SINDECOMU | 901 — Indenização Compensatória", true);
  paragraph(`Competências: ${report.competencies.map((item) => competencyLabel(item.month, item.year)).join(", ")}`);
  paragraph(`Bônus 565: histórico ${money(report.settings.bonusOldValueCents)} por unidade; novo ${money(report.settings.bonusNewValueCents)}. Domingos 901: histórico ${money(report.settings.sundayOldValueCents)} por domingo; novo ${money(report.settings.sundayNewValueCents)}.`);
  for (const override of report.settings.historicOverrides) {
    const competency = report.competencies.find((item) => item.key === override.competencyKey);
    paragraph(`Histórico específico ${competency ? competencyLabel(competency.month, competency.year) : override.competencyKey}: bônus ${money(override.bonusOldValueCents)}; domingo ${money(override.sundayOldValueCents)}.`);
  }
  paragraph("Método: quantidade validada pela referência da folha ou pelo valor pago dividido pelo unitário histórico. Novo total = quantidade × novo unitário. Adicional = máximo de zero e novo total menos pago. Valor novo menor não gera desconto.");
  paragraph("Ausência do evento não presume direito. Sem folha significa competência sem registro para o colaborador. Não reajustado significa valor novo não configurado. Este relatório não aplica percentual sobre INSS.");
  paragraph("Agrupamento por filial: considera a última competência em que cada colaborador consta nas bases importadas, inclusive quando houve transferência entre filiais.");
  paragraph(`Total geral: ${money(report.grandTotalCents)} | Bônus: ${money(report.bonusTotalCents)} | Domingos: ${money(report.sundayTotalCents)}`, true);

  const groups = new Map<string, EventAdjustmentEmployee[]>();
  for (const employee of report.employees) {
    const group = groups.get(employee.branchAlias) ?? [];
    group.push(employee);
    groups.set(employee.branchAlias, group);
  }
  for (const [branch, employees] of groups) {
    const bonus = employees.reduce((sum, employee) => sum + BigInt(employee.bonusDifferenceCents), 0n);
    const sunday = employees.reduce((sum, employee) => sum + BigInt(employee.sundayDifferenceCents), 0n);
    paragraph(`Filial ${branch} | ${employees.length} colaboradores | Bônus ${formatCents(bonus)} | Domingos ${formatCents(sunday)} | Total ${formatCents(bonus + sunday)}`, true);
  }

  details = true;
  page(true);
  for (const employees of groups.values()) {
    for (const employee of employees) {
      activeEmployee = null;
      const label = `Filial: ${employee.branchAlias} | Cadastro: ${employee.registration} | ${employee.employeeName}`.replace(/\s+/g, " ");
      ensure(textHeight(label, width - 12, 9, true) + 64);
      identity(employee);
      activeEmployee = employee;
      for (const competency of report.competencies) {
        const month = employee.months.find((item) => item.competency.key === competency.key);
        const historic = report.settings.historicOverrides.find((item) => item.competencyKey === competency.key);
        for (const event of ["565", "901"] as const) {
          const result = event === "565" ? month?.bonus565 : month?.indemnity901;
          const oldValue = event === "565" ? historic?.bonusOldValueCents ?? report.settings.bonusOldValueCents : historic?.sundayOldValueCents ?? report.settings.sundayOldValueCents;
          const newValue = event === "565" ? report.settings.bonusNewValueCents : report.settings.sundayNewValueCents;
          const received = !!month?.inPayroll && !!result?.received;
          const status = !month?.inPayroll ? "Sem folha" : !received ? "Evento ausente" : newValue === null ? "Recebeu; não reajustado" : result?.targetCents !== null && BigInt(result?.targetCents ?? "0") < BigInt(result?.paidCents ?? "0") ? "Adicional zero; sem desconto" : "Recebeu evento";
          const values = [
            competencyLabel(competency.month, competency.year), event === "565" ? "565\nBônus" : "901\nDomingos", status,
            received && result ? money(result.paidCents) : "—", money(oldValue),
            received && result && result.quantity !== null ? `${result.quantity} ${event === "565" ? "unid." : "dom."}` : "—",
            received && result ? quantitySource(result) : "—", money(newValue),
            received && result ? money(result.targetCents) : "—", money(result?.differenceCents ?? "0"),
          ];
          ensure(Math.max(24, ...values.map((value, index) => textHeight(value, columns[index].width - 8, 7.5) + 8)));
          row(values);
        }
      }
      y += 5;
      paragraph(`Total do colaborador: ${money(employee.totalDifferenceCents)} | Bônus: ${money(employee.bonusDifferenceCents)} | Domingos: ${money(employee.sundayDifferenceCents)}`, true);
      y += 6;
    }
  }
  activeEmployee = null;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 9;
    doc.font("Helvetica").fontSize(6.5).fillColor(COLORS.muted);
    doc.text("PerfectUtilitares | Documento confidencial — uso interno", left, footerY, { width: width - 180, lineBreak: false });
    doc.text(`Página ${index - range.start + 1} de ${range.count}`, left + width - 180, footerY, { width: 180, align: "right", lineBreak: false });
  }
}

function quantitySource(result: EventAdjustmentResult) {
  return result.quantitySource === "reference" ? "Referência da folha" : result.quantitySource === "amount" ? "Valor / histórico" : "—";
}
