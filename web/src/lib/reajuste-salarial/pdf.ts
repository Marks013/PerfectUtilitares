import PDFDocument from "pdfkit";
import { drawSalaryAdvanceReport, drawSalaryAdvanceFooters } from "./pdf-render";
import type { SalaryAdvanceReport, SalaryAdvancePdfKind } from "./types";
import type { EventAdjustmentReport } from "./event-adjustment-types";
import { buildSalaryAdvanceSummary } from "./advance-events";
import { drawSalaryAdvanceSummary, drawSalaryAdvanceEventDetail } from "./advance-events-pdf-render";

export function generateSalaryAdvancePdf(report: SalaryAdvanceReport, eventReport?: EventAdjustmentReport, kind: SalaryAdvancePdfKind = "detailed") {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 24, right: 24, bottom: 28, left: 24 },
      bufferPages: true,
      info: {
        Title: kind === "summary" ? "Antecipação Salarial — Resumo Consolidado" : "Antecipação Salarial — Apuração Detalhada",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const summary = buildSalaryAdvanceSummary(report, eventReport);
      if (kind === "summary") drawSalaryAdvanceSummary(doc, summary, report, eventReport);
      else if (eventReport) drawSalaryAdvanceEventDetail(doc, summary, report, eventReport);
      else drawSalaryAdvanceReport(doc, report, false);
      drawSalaryAdvanceFooters(doc, report);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
