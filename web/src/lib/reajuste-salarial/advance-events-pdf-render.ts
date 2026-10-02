import type PDFKit from "pdfkit";
import type { buildIntegratedAdvanceSummary } from "./advance-events";
import type { Competency } from "./types";
import { formatCents } from "./money";

const LABELS = ["Cadastro", "Colaborador", "Filial na última base", "Antecipação", "Bônus 565", "Domingos 901", "Total a pagar"];
const WEIGHTS = [70, 240, 145, 85, 70, 80, 100];

export function drawIntegratedAdvanceSummary(
  doc: PDFKit.PDFDocument,
  summary: ReturnType<typeof buildIntegratedAdvanceSummary>,
  competencies: Competency[],
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const totalWeight = WEIGHTS.reduce((sum, value) => sum + value, 0);
  const columns = WEIGHTS.map((weight, index) => ({
    x: left + WEIGHTS.slice(0, index).reduce((sum, value) => sum + value, 0) / totalWeight * width,
    width: weight / totalWeight * width,
  }));
  let y = doc.page.margins.top;

  function row(values: string[], header = false) {
    values = values.map(value => value.replace(/\s+/g, " ").trim());
    doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
    const height = Math.max(26, ...values.map((value, index) => Math.ceil(doc.heightOfString(value, { width: columns[index].width - 10 })) + 10));
    if (!header && y + height > bottom) { doc.addPage(); page(); }
    for (const [index, value] of values.entries()) {
      const column = columns[index];
      doc.rect(column.x, y, column.width, height).fillAndStroke(header ? "#13231f" : "#f5f8f7", "#d7dfdc");
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(header ? "#ffffff" : "#17211e")
        .text(value, column.x + 5, y + 5, { width: column.width - 10, align: index >= 3 ? "right" : "left" });
    }
    y += height;
  }

  function page() {
    y = doc.page.margins.top;
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#13231f")
      .text("Antecipação com bônus e domingos — resumo consolidado", left, y, { width });
    y += 27;
    doc.font("Helvetica").fontSize(8).fillColor("#17211e")
      .text(`Competências: ${competencies.map(({ key }) => key.replace("-", "/")).join(", ")} | ${summary.employees.length} colaboradores`, left, y, { width });
    y += 18;
    doc.font("Helvetica-Bold").fontSize(9)
      .text(`Antecipação ${formatCents(summary.advanceTotalCents)} | Bônus ${formatCents(summary.bonusTotalCents)} | Domingos ${formatCents(summary.sundayTotalCents)} | Total a pagar ${formatCents(summary.grandTotalCents)}`, left, y, { width });
    y += 24;
    doc.font("Helvetica").fontSize(7.5)
      .text("O total reúne a antecipação e somente as diferenças dos eventos. Os valores já pagos nas folhas não são somados novamente. As próximas seções detalham os cálculos por competência.", left, y, { width });
    y += 30;
    row(LABELS, true);
  }

  page();
  for (const employee of summary.employees) {
    row([employee.registration, employee.employeeName, employee.branchAlias, formatCents(employee.advanceCents), formatCents(employee.bonusCents), formatCents(employee.sundayCents), formatCents(employee.totalCents)]);
  }
}
