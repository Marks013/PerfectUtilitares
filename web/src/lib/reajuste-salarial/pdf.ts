import PDFDocument from "pdfkit";
import { drawSalaryAdvanceReport } from "./pdf-render";
import type { SalaryAdvanceReport } from "./types";
import type { EventAdjustmentReport } from "./event-adjustment-types";
import { buildIntegratedAdvanceSummary } from "./advance-events";
import { drawIntegratedAdvanceSummary } from "./advance-events-pdf-render";
import { drawEventAdjustmentReport } from "./event-adjustment-pdf-render";

export function generateSalaryAdvancePdf(report: SalaryAdvanceReport, eventReport?: EventAdjustmentReport) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 24, right: 24, bottom: 28, left: 24 },
      bufferPages: true,
      info: {
        Title: eventReport ? "Antecipação Salarial com diferenças de bônus e domingos" : "Antecipação Salarial",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      if (eventReport) {
        const summary = buildIntegratedAdvanceSummary(report, eventReport);
        drawIntegratedAdvanceSummary(doc, summary, report.competencies);
        doc.addPage();
        drawSalaryAdvanceReport(doc, report, false);
        doc.addPage();
        // This final section numbers every buffered page once, including the summary and advance.
        drawEventAdjustmentReport(doc, eventReport);
      } else {
        drawSalaryAdvanceReport(doc, report);
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
