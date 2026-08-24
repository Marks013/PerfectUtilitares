import PDFDocument from "pdfkit";
import { drawSalaryRevisionReport } from "./salary-revision-pdf-render";
import type { SalaryRevisionReport } from "./salary-revision-types";

export function generateSalaryRevisionPdf(report: SalaryRevisionReport) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 24, right: 24, bottom: 28, left: 24 },
      bufferPages: true,
      info: {
        Title: "Reajuste Salarial",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawSalaryRevisionReport(doc, report);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
