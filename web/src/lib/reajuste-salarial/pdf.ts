import PDFDocument from "pdfkit";
import { drawSalaryAdjustmentReport } from "./pdf-render";
import type { AdjustmentReport } from "./types";

export function generateSalaryAdjustmentPdf(report: AdjustmentReport) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 24, right: 24, bottom: 28, left: 24 },
      bufferPages: true,
      info: {
        Title: "Reajuste Salarial Retroativo",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      drawSalaryAdjustmentReport(doc, report);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
