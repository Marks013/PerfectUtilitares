import type PDFKit from "pdfkit";
import { formatCents, formatPercentage } from "./money";
import type {
  AppliedSalaryRevisionEmployee,
  SalaryRevisionBranchGroup,
  SalaryRevisionReport,
} from "./salary-revision-types";

type ColumnKind =
  | "registration"
  | "name"
  | "role"
  | "current"
  | "application"
  | "percentage"
  | "adjustment"
  | "new";

type Column = {
  kind: ColumnKind;
  label: string;
  x: number;
  width: number;
};

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
const HEADER_HEIGHT = 24;
const BRANCH_HEIGHT = 22;
const FOOTER_RESERVE = 18;

function percentageLabel(report: SalaryRevisionReport) {
  return report.generalPercentageBasisPoints === null
    ? "não aplicado"
    : formatPercentage(report.generalPercentageBasisPoints);
}

function scopeLabel(report: SalaryRevisionReport) {
  return report.adjustmentScope === "rules_only"
    ? "Somente selecionados nas regras"
    : "Todos os colaboradores";
}

function columns(usableWidth: number, left: number) {
  const definitions = [
    { kind: "registration" as const, label: "Cadastro", weight: 0.65 },
    { kind: "name" as const, label: "Nome", weight: 1.8 },
    { kind: "role" as const, label: "Cargo", weight: 1.35 },
    { kind: "current" as const, label: "Salário atual", weight: 0.88 },
    { kind: "application" as const, label: "Regra aplicada", weight: 1.05 },
    { kind: "percentage" as const, label: "Percentual", weight: 0.72 },
    { kind: "adjustment" as const, label: "Reajuste", weight: 0.88 },
    { kind: "new" as const, label: "Novo salário", weight: 0.88 },
  ];
  const totalWeight = definitions.reduce((sum, item) => sum + item.weight, 0);
  let cursor = left;
  return definitions.map((definition, index): Column => {
    const width =
      index === definitions.length - 1
        ? left + usableWidth - cursor
        : (usableWidth * definition.weight) / totalWeight;
    const column = { ...definition, x: cursor, width };
    cursor += width;
    return column;
  });
}

function cellValue(
  employee: AppliedSalaryRevisionEmployee,
  column: Column,
  report: SalaryRevisionReport,
) {
  if (column.kind === "registration") return employee.registration;
  if (column.kind === "name") return employee.employeeName;
  if (column.kind === "role") return employee.role;
  if (column.kind === "current") return formatCents(employee.currentSalaryCents);
  if (column.kind === "adjustment") return formatCents(employee.adjustmentCents);
  if (column.kind === "new") return formatCents(employee.newSalaryCents);
  if (column.kind === "percentage") {
    if (employee.application.kind === "special" && employee.application.percentageBasisPoints !== undefined) {
      return formatPercentage(employee.application.percentageBasisPoints);
    }
    return employee.application.kind === "general" &&
      report.generalPercentageBasisPoints !== null
      ? formatPercentage(report.generalPercentageBasisPoints)
      : "—";
  }
  return employee.application.kind === "general"
    ? "Percentual geral"
    : employee.application.ruleName;
}

function clippedText(
  doc: PDFKit.PDFDocument,
  value: string,
  column: Column,
  y: number,
  height: number,
  options: {
    align?: "left" | "right" | "center";
    font?: string;
    color?: string;
    size?: number;
  } = {},
) {
  const padding = 3;
  doc.save().rect(column.x, y, column.width, height).clip();
  doc
    .font(options.font ?? "Helvetica")
    .fontSize(options.size ?? 7.5)
    .fillColor(options.color ?? COLORS.ink)
    .text(value, column.x + padding, y + padding, {
      width: Math.max(1, column.width - padding * 2),
      height: Math.max(1, height - padding * 2),
      align: options.align ?? "left",
      ellipsis: true,
    });
  doc.restore();
}

function pageHeader(
  doc: PDFKit.PDFDocument,
  report: SalaryRevisionReport,
  firstPage: boolean,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  if (!firstPage) {
    doc
      .fillColor(COLORS.brand)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Reajuste Salarial", left, doc.page.margins.top, { width: 260 });
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `${scopeLabel(report)} | Percentual geral ${percentageLabel(report)} | ${report.specialEmployeeCount.toLocaleString("pt-BR")} em regras especiais`,
        left + 270,
        doc.page.margins.top + 2,
        { width: width - 270, align: "right" },
      );
    return doc.page.margins.top + 24;
  }
  const top = doc.page.margins.top;
  doc.roundedRect(left, top, width, 66, 8).fill(COLORS.brand);
  doc.rect(left, top, 7, 66).fill(COLORS.accent);
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text("Reajuste Salarial", left + 20, top + 12, { width: 300 });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#dbe7e2")
    .text(
      `Escopo: ${scopeLabel(report)} | Percentual geral: ${percentageLabel(report)} | Regras especiais: ${report.rules.length.toLocaleString("pt-BR")}`,
      left + 20,
      top + 37,
      { width: 480 },
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(COLORS.accent)
    .text(formatCents(report.totalAdjustmentCents), left + width - 205, top + 12, {
      width: 185,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLORS.white)
    .text(
      `${report.employeeCount.toLocaleString("pt-BR")} colaboradores no escopo | Novo total ${formatCents(report.newPayrollCents)}`,
      left + width - 260,
      top + 38,
      { width: 240, align: "right" },
    );
  const generated = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(report.generatedAt);
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7)
    .text(`Arquivo: ${report.sourceFile} | Gerado em ${generated}`, left, top + 72, {
      width,
      ellipsis: true,
    });
  return top + 86;
}

function tableHeader(doc: PDFKit.PDFDocument, reportColumns: Column[], y: number) {
  for (const column of reportColumns) {
    doc
      .rect(column.x, y, column.width, HEADER_HEIGHT)
      .fillAndStroke(COLORS.brand, COLORS.white);
    clippedText(doc, column.label, column, y, HEADER_HEIGHT, {
      align: column.kind === "name" || column.kind === "role" ? "left" : "center",
      font: "Helvetica-Bold",
      color: COLORS.white,
      size: 7.5,
    });
  }
  return y + HEADER_HEIGHT;
}

function branchBand(
  doc: PDFKit.PDFDocument,
  group: SalaryRevisionBranchGroup,
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
      width: width - 330,
      ellipsis: true,
    });
  doc
    .fontSize(7)
    .text(
      `${group.employeeCount.toLocaleString("pt-BR")} colaboradores | Reajuste ${formatCents(group.adjustmentSubtotalCents)} | Novo total ${formatCents(group.newPayrollCents)}`,
      left + width - 320,
      y + 7,
      { width: 314, align: "right" },
    );
  return y + BRANCH_HEIGHT;
}

function rowHeight(
  doc: PDFKit.PDFDocument,
  reportColumns: Column[],
  employee: AppliedSalaryRevisionEmployee,
  report: SalaryRevisionReport,
) {
  doc.font("Helvetica").fontSize(7.5);
  const height = Math.max(
    ...reportColumns
      .filter((column) =>
        column.kind === "name" ||
        column.kind === "role" ||
        column.kind === "application",
      )
      .map((column) =>
        doc.heightOfString(cellValue(employee, column, report), {
          width: column.width - 6,
          lineGap: 0,
        }),
      ),
  );
  return Math.max(20, Math.ceil(height + 6));
}

function totalsRow(
  doc: PDFKit.PDFDocument,
  reportColumns: Column[],
  label: string,
  current: bigint,
  adjustment: bigint,
  updated: bigint,
  y: number,
) {
  const height = 26;
  const labelColumns = reportColumns.filter((column) =>
    column.kind === "registration" || column.kind === "name" || column.kind === "role",
  );
  const labelColumn: Column = {
    ...labelColumns[0],
    width: labelColumns.reduce((total, column) => total + column.width, 0),
  };
  doc.rect(labelColumn.x, y, labelColumn.width, height).fillAndStroke(COLORS.branch, COLORS.border);
  clippedText(doc, label, labelColumn, y, height, { font: "Helvetica-Bold" });
  for (const column of reportColumns.filter((item) => !labelColumns.includes(item))) {
    doc.rect(column.x, y, column.width, height).fillAndStroke(COLORS.branch, COLORS.border);
    const value = column.kind === "current" ? formatCents(current)
      : column.kind === "adjustment" ? formatCents(adjustment)
        : column.kind === "new" ? formatCents(updated) : "";
    clippedText(doc, value, column, y, height, { align: "right", font: "Helvetica-Bold" });
  }
  return y + height;
}

function employeeRow(
  doc: PDFKit.PDFDocument,
  reportColumns: Column[],
  employee: AppliedSalaryRevisionEmployee,
  report: SalaryRevisionReport,
  y: number,
  height: number,
  striped: boolean,
) {
  for (const column of reportColumns) {
    doc
      .rect(column.x, y, column.width, height)
      .fillAndStroke(striped ? COLORS.stripe : COLORS.white, COLORS.border);
    clippedText(doc, cellValue(employee, column, report), column, y, height, {
      align:
        column.kind === "current" ||
        column.kind === "adjustment" ||
        column.kind === "new"
          ? "right"
          : "left",
      font: column.kind === "new" ? "Helvetica-Bold" : "Helvetica",
    });
  }
  return y + height;
}

function footers(doc: PDFKit.PDFDocument, report: SalaryRevisionReport) {
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

export function drawSalaryRevisionReport(
  doc: PDFKit.PDFDocument,
  report: SalaryRevisionReport,
) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;
  const reportColumns = columns(usableWidth, left);
  const contentBottom = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE;
  let y = tableHeader(doc, reportColumns, pageHeader(doc, report, true));
  let striped = false;
  for (const [groupIndex, group] of report.groups.entries()) {
    const firstHeight = rowHeight(doc, reportColumns, group.employees[0], report);
    if (groupIndex > 0 || y + BRANCH_HEIGHT + firstHeight > contentBottom) {
      doc.addPage();
      y = tableHeader(doc, reportColumns, pageHeader(doc, report, false));
    }
    y = branchBand(doc, group, y, false);
    for (const [employeeIndex, employee] of group.employees.entries()) {
      const height = rowHeight(doc, reportColumns, employee, report);
      const finalReserve = employeeIndex === group.employees.length - 1 ? 26 : 0;
      if (y + height + finalReserve > contentBottom) {
        doc.addPage();
        y = tableHeader(doc, reportColumns, pageHeader(doc, report, false));
        y = branchBand(doc, group, y, true);
      }
      y = employeeRow(doc, reportColumns, employee, report, y, height, striped);
      striped = !striped;
    }
    y = totalsRow(doc, reportColumns, `Total ${group.branchAlias} | ${group.employeeCount.toLocaleString("pt-BR")} colaboradores`, group.currentPayrollCents, group.adjustmentSubtotalCents, group.newPayrollCents, y);
  }
  if (y + 32 > contentBottom) {
    doc.addPage();
    y = tableHeader(doc, reportColumns, pageHeader(doc, report, false));
  }
  totalsRow(doc, reportColumns, `Total geral | ${report.employeeCount.toLocaleString("pt-BR")} colaboradores`, report.currentPayrollCents, report.totalAdjustmentCents, report.newPayrollCents, y + 6);
  footers(doc, report);
}
