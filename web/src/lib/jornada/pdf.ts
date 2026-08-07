import PDFDocument from "pdfkit";
import {
  getGroupHeight,
  getJornadaPdfDebugGroups as buildJornadaPdfDebugGroups,
  groupEntries,
  type JornadaPdfDebugGroup as JornadaPdfDebugGroupData,
  type JornadaPdfEntry,
} from "./pdf-history-data";
import {
  drawFooter,
  drawGroup,
  drawHeader,
  drawSignature,
} from "./pdf-history-render";

export type { JornadaPdfEntry } from "./pdf-history-data";

export type JornadaPdfDebugGroup = JornadaPdfDebugGroupData;

export function getJornadaPdfDebugGroups(
  entries: JornadaPdfEntry[],
): JornadaPdfDebugGroup[] {
  return buildJornadaPdfDebugGroups(entries);
}

export function generateJornadaHistoryPdf(entries: JornadaPdfEntry[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: "Alteração de Jornada",
        Author: "PerfectUtilitares",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const groups = groupEntries(entries);
    drawHeader(doc, groups, entries.length);

    let y = 204;
    groups.forEach((group, index) => {
      const groupHeight = getGroupHeight(group);
      if (y + groupHeight > 742) {
        doc.addPage();
        y = 54;
      }

      drawGroup(doc, group, index, y);
      y += groupHeight + 9;
    });

    if (y > 690) {
      doc.addPage();
      y = 120;
    } else {
      y += 42;
    }

    drawSignature(doc, y);
    drawFooter(doc);

    doc.end();
  });
}
