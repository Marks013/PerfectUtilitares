import type PDFKit from "pdfkit";
import { formatCents, formatPercentageHundredThousandths } from "./money";
import { salaryAdvanceScopeLabel, salaryAdvancePercentageLabel } from "./pdf-scope-display";
import {
  allocateReportColumns,
  hasVerticalSpace,
  type ReportColumn,
} from "./pdf-layout";
import type {
  BranchReportGroup,
  ConsolidatedEmployee,
  SalaryAdvanceReport,
} from "./types";

const COLORS = {
  brand: "#13231f",
  accent: "#f5c542",
  ink: "#17211e",
  muted: "#64748b",
  border: "#d7dfdc",
  stripe: "#f5f8f7",
  branch: "#e7efec",
  white: "#ffffff",
};
const TABLE_HEADER_HEIGHT = 40;
const BRANCH_HEIGHT = 22;
const FOOTER_RESERVE = 18;

function drawClippedText(
  doc: PDFKit.PDFDocument,
  value: string,
  column: ReportColumn,
  y: number,
  height: number,
  options: { align?: "left" | "right" | "center"; font?: string; color?: string; size?: number } = {},
) {
  const padding = 3;
  doc.save().rect(column.x, y, column.width, height).clip();
  doc
    .font(options.font ?? "Helvetica")
    .fontSize(options.size ?? 6.5)
    .fillColor(options.color ?? COLORS.ink)
    .text(value, column.x + padding, y + padding, {
      width: Math.max(1, column.width - padding * 2),
      height: Math.max(1, height - padding * 2),
      align: options.align ?? "left",
      lineBreak: true,
    });
  doc.restore();
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  columns: ReportColumn[],
  y: number,
) {
  for (const column of columns) {
    doc
      .rect(column.x, y, column.width, TABLE_HEADER_HEIGHT)
      .fillAndStroke(COLORS.brand, COLORS.white);
    drawClippedText(doc, column.label, column, y, TABLE_HEADER_HEIGHT, {
      align: column.kind === "name" ? "left" : "center",
      font: "Helvetica-Bold",
      color: COLORS.white,
      size: 6.5,
    });
  }
  return y + TABLE_HEADER_HEIGHT;
}

function competenciesLabel(report: SalaryAdvanceReport) {
  return report.competencies.map((item) => item.key).join(" • ");
}

function drawPageHeader(
  doc: PDFKit.PDFDocument,
  report: SalaryAdvanceReport,
  firstPage: boolean,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  if (!firstPage) {
    doc
      .fillColor(COLORS.brand)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Antecipação Salarial", left, doc.page.margins.top, { width: 280 });
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `${competenciesLabel(report)} | ${salaryAdvancePercentageLabel(report)}`,
        left + 290,
        doc.page.margins.top + 2,
        { width: width - 290, align: "right" },
      );
    doc.font("Helvetica").fontSize(7.5).text(salaryAdvanceScopeLabel(report), left, doc.page.margins.top + 20, { width });
    return doc.page.margins.top + 38;
  }

  const top = doc.page.margins.top;
  doc.roundedRect(left, top, width, 62, 8).fill(COLORS.brand);
  doc.rect(left, top, 7, 62).fill(COLORS.accent);
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text("Antecipação Salarial", left + 20, top + 13, { width: 330 });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#dbe7e2")
    .text(
      `Competências: ${competenciesLabel(report)} | ${salaryAdvancePercentageLabel(report)}`,
      left + 20,
      top + 38,
      { width: 500 },
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(COLORS.accent)
    .text(formatCents(report.grandTotalCents), left + width - 205, top + 14, {
      width: 185,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLORS.white)
    .text(`${report.employeeCount.toLocaleString("pt-BR")} colaboradores`, left + width - 205, top + 38, {
      width: 185,
      align: "right",
    });
  const generated = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(report.generatedAt);
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7)
    .text(`Gerado em ${generated}`, left, top + 68, { width });
  doc.text(
    salaryAdvanceScopeLabel(report),
    left,
    top + 81,
    { width },
  );
  doc.text("Bloqueio por competência: Lic. s/ Remuneração, Demitido, Aposent. Invalidez e Detenção.", left, top + 94, { width });
  return top + 117;
}

function branchBandHeight(doc: PDFKit.PDFDocument, group: BranchReportGroup, continuation: boolean) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font("Helvetica-Bold").fontSize(8);
  const label = `${group.branchAlias.replace(/\s+/g, " ")}${continuation ? " (continuação)" : ""}`;
  return Math.max(BRANCH_HEIGHT, Math.ceil(doc.heightOfString(label, { width: width - 250 })) + 14);
}

function drawBranchBand(
  doc: PDFKit.PDFDocument,
  group: BranchReportGroup,
  y: number,
  continuation: boolean,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const label = `${group.branchAlias.replace(/\s+/g, " ")}${continuation ? " (continuação)" : ""}`;
  doc.font("Helvetica-Bold").fontSize(8);
  const bandHeight = branchBandHeight(doc, group, continuation);
  doc.rect(left, y, width, bandHeight).fillAndStroke(COLORS.branch, COLORS.border);
  doc
    .fillColor(COLORS.brand)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label, left + 6, y + 7, {
      width: width - 250,
    });
  doc
    .fontSize(7)
    .text(
      `${group.employeeCount.toLocaleString("pt-BR")} colaboradores | Subtotal ${formatCents(group.subtotalCents)}`,
      left + width - 240,
      y + 7,
      { width: 234, align: "right" },
    );
  return y + bandHeight;
}

function employeeCellValue(
  employee: ConsolidatedEmployee,
  column: ReportColumn,
) {
  if (column.kind === "branch") return employee.branchAlias.replace(/\s+/g, " ");
  if (column.kind === "registration") return employee.registration;
  if (column.kind === "name") return employee.employeeName.replace(/\s+/g, " ");
  if (column.kind === "total") return formatCents(employee.totalAdjustmentCents);
  const key = column.competencyKey ?? "";
  if (column.kind === "base") {
    const base = employee.basesByCompetency.get(key) ?? null;
    return base === null ? "—" : formatCents(base);
  }
  const rule = employee.advanceRulesByCompetency?.get(key);
  const amount = formatCents(employee.adjustmentsByCompetency.get(key) ?? 0n);
  if (rule?.exclusionReason) return `${amount}\nBloqueado`;
  return rule ? `${amount}\n${formatPercentageHundredThousandths(rule.percentageHundredThousandths ?? rule.percentageTenThousandths * 10n)}` : amount;
}

function getEmployeeRowHeight(
  doc: PDFKit.PDFDocument,
  columns: ReportColumn[],
  employee: ConsolidatedEmployee,
) {
  doc.font("Helvetica").fontSize(6.5);
  const textColumns = columns.filter(
    (column) => column.kind === "branch" || column.kind === "name" || column.kind === "adjustment",
  );
  const height = Math.max(
    ...textColumns.map((column) =>
      doc.heightOfString(employeeCellValue(employee, column), {
        width: column.width - 6,
        lineGap: 0,
      }),
    ),
  );
  return Math.max(18, Math.ceil(height + 6));
}

function employeeRuleNotes(employee: ConsolidatedEmployee) {
  return Array.from(employee.advanceRulesByCompetency ?? []).flatMap(([key, rule]) => {
    if (rule.scopeEligible === false) return [`${key}: bloqueado por cargo: ${rule.exclusionReason}`];
    if (rule.exclusionReason) return [`${key}: bloqueado por situação ${rule.employmentStatus ?? rule.exclusionReason}`];
    if (!rule.metadataKnown) return [`${key}: situação ou cargo não informados na base; confira a elegibilidade e o percentual aplicado`];
    return [];
  }).join(" | ").replace(/\s+/g, " ");
}

function drawEmployeeRow(
  doc: PDFKit.PDFDocument,
  columns: ReportColumn[],
  employee: ConsolidatedEmployee,
  y: number,
  height: number,
  striped: boolean,
) {
  for (const column of columns) {
    doc
      .rect(column.x, y, column.width, height)
      .fillAndStroke(striped ? COLORS.stripe : COLORS.white, COLORS.border);
    drawClippedText(doc, employeeCellValue(employee, column), column, y, height, {
      align:
        column.kind === "base" || column.kind === "adjustment" || column.kind === "total"
          ? "right"
          : "left",
      font: column.kind === "total" ? "Helvetica-Bold" : "Helvetica",
    });
  }
  return y + height;
}

export function drawSalaryAdvanceFooters(doc: PDFKit.PDFDocument, report: SalaryAdvanceReport) {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const y = doc.page.height - doc.page.margins.bottom - 9;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor(COLORS.border).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6.5);
    doc.text("PerfectUtilitares", left, y, { width: 160, lineBreak: false });
    if (pageIndex === range.start) {
      doc.text("Documento confidencial — uso interno", left + 180, y, {
        width: right - left - 360,
        align: "center",
        lineBreak: false,
      });
    }
    doc.text(
      `Página ${pageIndex - range.start + 1} de ${range.count} | ${report.parserProfile}`,
      right - 210,
      y,
      { width: 210, align: "right", lineBreak: false },
    );
  }
}

export function drawSalaryAdvanceReport(
  doc: PDFKit.PDFDocument,
  report: SalaryAdvanceReport,
  includeFooter = true,
) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;
  const columns = allocateReportColumns(usableWidth, report.competencies, left);
  const contentBottom = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE;
  let y = drawTableHeader(doc, columns, drawPageHeader(doc, report, true));
  let striped = false;

  for (const group of report.groups) {
    const firstHeight = getEmployeeRowHeight(doc, columns, group.employees[0]);
    if (!hasVerticalSpace(y, branchBandHeight(doc, group, false) + firstHeight, contentBottom)) {
      doc.addPage();
      y = drawTableHeader(doc, columns, drawPageHeader(doc, report, false));
    }
    y = drawBranchBand(doc, group, y, false);

    for (const employee of group.employees) {
      const rowHeight = getEmployeeRowHeight(doc, columns, employee);
      const notes = employeeRuleNotes(employee);
      doc.font("Helvetica").fontSize(6.5);
      const notesHeight = notes ? Math.ceil(doc.heightOfString(notes, { width: usableWidth - 12 })) + 8 : 0;
      if (!hasVerticalSpace(y, rowHeight + notesHeight, contentBottom)) {
        doc.addPage();
        y = drawTableHeader(doc, columns, drawPageHeader(doc, report, false));
        y = drawBranchBand(doc, group, y, true);
      }
      y = drawEmployeeRow(doc, columns, employee, y, rowHeight, striped);
      if (notes) {
        doc.rect(left, y, usableWidth, notesHeight).fillAndStroke(COLORS.stripe, COLORS.border);
        doc.font("Helvetica").fontSize(6.5).fillColor(COLORS.muted)
          .text(notes, left + 6, y + 4, { width: usableWidth - 12 });
        y += notesHeight;
      }
      striped = !striped;
    }
  }

  if (includeFooter) drawSalaryAdvanceFooters(doc, report);
}
