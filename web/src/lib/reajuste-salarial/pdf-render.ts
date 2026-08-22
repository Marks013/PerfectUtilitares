import type PDFKit from "pdfkit";
import { formatCents, formatPercentage } from "./money";
import {
  allocateReportColumns,
  employeeRowHeight,
  hasVerticalSpace,
  type ReportColumn,
} from "./pdf-layout";
import type {
  AdjustmentReport,
  BranchReportGroup,
  ConsolidatedEmployee,
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
      ellipsis: true,
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

function competenciesLabel(report: AdjustmentReport) {
  return report.competencies.map((item) => item.key).join(" • ");
}

function drawPageHeader(
  doc: PDFKit.PDFDocument,
  report: AdjustmentReport,
  firstPage: boolean,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  if (!firstPage) {
    doc
      .fillColor(COLORS.brand)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Reajuste Salarial Retroativo", left, doc.page.margins.top, { width: 280 });
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `${competenciesLabel(report)} | ${formatPercentage(report.percentageBasisPoints)}`,
        left + 290,
        doc.page.margins.top + 2,
        { width: width - 290, align: "right" },
      );
    return doc.page.margins.top + 24;
  }

  const top = doc.page.margins.top;
  doc.roundedRect(left, top, width, 62, 8).fill(COLORS.brand);
  doc.rect(left, top, 7, 62).fill(COLORS.accent);
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text("Reajuste Salarial Retroativo", left + 20, top + 13, { width: 330 });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#dbe7e2")
    .text(
      `Competências: ${competenciesLabel(report)} | Percentual restante: ${formatPercentage(report.percentageBasisPoints)}`,
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
  return top + 82;
}

function drawBranchBand(
  doc: PDFKit.PDFDocument,
  group: BranchReportGroup,
  y: number,
  continuation: boolean,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.rect(left, y, width, BRANCH_HEIGHT).fillAndStroke(COLORS.branch, COLORS.border);
  doc
    .fillColor(COLORS.brand)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(`${group.branchAlias}${continuation ? " (continuação)" : ""}`, left + 6, y + 7, {
      width: width - 250,
      ellipsis: true,
    });
  doc
    .fontSize(7)
    .text(
      `${group.employeeCount.toLocaleString("pt-BR")} colaboradores | Subtotal ${formatCents(group.subtotalCents)}`,
      left + width - 240,
      y + 7,
      { width: 234, align: "right" },
    );
  return y + BRANCH_HEIGHT;
}

function employeeCellValue(
  employee: ConsolidatedEmployee,
  column: ReportColumn,
) {
  if (column.kind === "branch") return employee.branchAlias;
  if (column.kind === "registration") return employee.registration;
  if (column.kind === "name") return employee.employeeName;
  if (column.kind === "total") return formatCents(employee.totalAdjustmentCents);
  const key = column.competencyKey ?? "";
  if (column.kind === "base") {
    const base = employee.basesByCompetency.get(key) ?? null;
    return base === null ? "—" : formatCents(base);
  }
  return formatCents(employee.adjustmentsByCompetency.get(key) ?? 0n);
}

function getEmployeeRowHeight(
  doc: PDFKit.PDFDocument,
  columns: ReportColumn[],
  employee: ConsolidatedEmployee,
) {
  doc.font("Helvetica").fontSize(6.5);
  const textColumns = columns.filter(
    (column) => column.kind === "branch" || column.kind === "name",
  );
  const height = Math.max(
    ...textColumns.map((column) =>
      doc.heightOfString(employeeCellValue(employee, column), {
        width: column.width - 6,
        lineGap: 0,
      }),
    ),
  );
  return employeeRowHeight(height);
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

function drawFooters(doc: PDFKit.PDFDocument, report: AdjustmentReport) {
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

export function drawSalaryAdjustmentReport(
  doc: PDFKit.PDFDocument,
  report: AdjustmentReport,
) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;
  const columns = allocateReportColumns(usableWidth, report.competencies, left);
  const contentBottom = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE;
  let y = drawTableHeader(doc, columns, drawPageHeader(doc, report, true));
  let striped = false;

  for (const group of report.groups) {
    const firstHeight = getEmployeeRowHeight(doc, columns, group.employees[0]);
    if (!hasVerticalSpace(y, BRANCH_HEIGHT + firstHeight, contentBottom)) {
      doc.addPage();
      y = drawTableHeader(doc, columns, drawPageHeader(doc, report, false));
    }
    y = drawBranchBand(doc, group, y, false);

    for (const employee of group.employees) {
      const rowHeight = getEmployeeRowHeight(doc, columns, employee);
      if (!hasVerticalSpace(y, rowHeight, contentBottom)) {
        doc.addPage();
        y = drawTableHeader(doc, columns, drawPageHeader(doc, report, false));
        y = drawBranchBand(doc, group, y, true);
      }
      y = drawEmployeeRow(doc, columns, employee, y, rowHeight, striped);
      striped = !striped;
    }
  }

  drawFooters(doc, report);
}
