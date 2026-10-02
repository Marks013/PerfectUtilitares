import PDFDocument from "pdfkit";
import { drawEventAdjustmentReport } from "./event-adjustment-pdf-render";
import type { EventAdjustmentReport } from "./event-adjustment-types";
import { SalaryAdjustmentError } from "./errors";
import { MAX_EVENT_IDENTITY_LENGTH } from "./limits";

export async function generateEventAdjustmentPdf(report: EventAdjustmentReport): Promise<Buffer> {
  if (report.employees.some(({ registration, employeeName, branchAlias }) => [registration, employeeName, branchAlias].some((value) => value.length > MAX_EVENT_IDENTITY_LENGTH))) {
    throw new SalaryAdjustmentError("REAJUSTE_STRUCTURE_INVALID", `A identificação do colaborador ou da filial ultrapassa ${MAX_EVENT_IDENTITY_LENGTH} caracteres. Confira a folha antes de gerar o PDF.`);
  }
  if (report.issueCount > 0 || report.employees.some((employee) => employee.months.some(
    (month) => month.bonus565.issue || month.indemnity901.issue,
  ))) {
    throw new Error("Resolva todas as pendências antes de gerar o PDF de diferenças dos eventos 565 e 901.");
  }
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 24, right: 24, bottom: 28, left: 24 },
      bufferPages: true,
      info: { Title: "Diferenças dos eventos 565 e 901", Author: "PerfectUtilitares" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawEventAdjustmentReport(doc, report);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
