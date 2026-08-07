import PDFDocument from "pdfkit";
import type { JornadaBatchReport } from "./batch-types";
import {
  drawDetailedSchedules,
  drawErrors,
  drawFooter,
  drawFrequentSchedules,
  drawHeader,
  drawNoErrors,
  drawSummary,
} from "./batch-pdf-render";

export {
  formatBatchLineLabel,
  getBatchDetailedScheduleGroups,
} from "./batch-pdf-data";

export type JornadaBatchPdfOptions = {
  detalhado?: boolean;
};

export function generateJornadaBatchReportPdf(
  report: JornadaBatchReport,
  options: JornadaBatchPdfOptions = {},
) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: "Relatorio de Validacao de Jornadas",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    drawHeader(doc);
    drawSummary(doc, report, 124);

    let y = 222;
    y =
      report.linhasComErro.length > 0
        ? drawErrors(doc, report, y)
        : drawNoErrors(doc, y);
    if (options.detalhado) {
      drawDetailedSchedules(doc, report, y + 10);
    } else {
      drawFrequentSchedules(doc, report, y + 10);
    }
    drawFooter(doc);

    doc.end();
  });
}
