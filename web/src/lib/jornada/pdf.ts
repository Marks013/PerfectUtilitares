import PDFDocument from "pdfkit";

export type JornadaPdfRecord = {
  id: string;
  createdAt: Date;
  horariosOriginal: string;
  horariosNormalizado: string;
  valido: boolean;
  mensagem: string;
  duracaoCalculada: string | null;
  tipoDia: string;
  codigo: string | null;
  horasSemanais: number | null;
  horasMensais: number | null;
  intervalo: string | null;
  user?: { name: string | null; email: string | null } | null;
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);
}

function getUserLabel(record: JornadaPdfRecord) {
  return record.user?.name ?? record.user?.email ?? "Sem usuario";
}

function getPeriodLabel(records: JornadaPdfRecord[]) {
  if (records.length === 0) {
    return "-";
  }

  const dates = records
    .map((record) => record.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());
  const first = formatDateOnly(dates[0]);
  const last = formatDateOnly(dates[dates.length - 1]);

  return first === last ? first : `${first} a ${last}`;
}

function drawSummaryCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string | number,
) {
  doc
    .roundedRect(x, y, width, 54, 10)
    .fillAndStroke("#f8fafc", "#dbe4ef");
  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label.toUpperCase(), x + 12, y + 11, { width: width - 24 });
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(String(value), x + 12, y + 27, { width: width - 24 });
}

function drawHeader(doc: PDFKit.PDFDocument, records: JornadaPdfRecord[]) {
  const { width } = doc.page;
  const margin = doc.page.margins.left;
  const contentWidth = width - margin * 2;

  doc
    .roundedRect(margin, 36, contentWidth, 92, 16)
    .fillAndStroke("#102a43", "#102a43");
  doc
    .fillColor("#c7d2fe")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("VALIDADOR DE JORNADA", margin + 22, 54, {
      characterSpacing: 0.8,
    });
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Relatorio de jornadas validas", margin + 22, 72, {
      width: contentWidth - 44,
    });
  doc
    .fillColor("#dbeafe")
    .font("Helvetica")
    .fontSize(9)
    .text(`Gerado em ${formatDate(new Date())}`, margin + 22, 102, {
      width: contentWidth - 44,
    });

  const gap = 12;
  const cardWidth = (contentWidth - gap * 2) / 3;
  const summaryY = 146;

  drawSummaryCard(doc, margin, summaryY, cardWidth, "Jornadas", records.length);
  drawSummaryCard(
    doc,
    margin + cardWidth + gap,
    summaryY,
    cardWidth,
    "Periodo",
    getPeriodLabel(records),
  );
  drawSummaryCard(
    doc,
    margin + (cardWidth + gap) * 2,
    summaryY,
    cardWidth,
    "Status",
    "Validas",
  );

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Jornadas selecionadas", margin, 226);
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;

  doc.roundedRect(margin, y, width, 26, 8).fill("#eef2f7");
  doc
    .fillColor("#475569")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("HORARIOS", margin + 18, y + 9, { width: 190 })
    .text("DETALHES", margin + 240, y + 9, { width: 172 })
    .text("STATUS", margin + width - 84, y + 9, {
      width: 66,
      align: "right",
    });
}

function drawRecordRow(
  doc: PDFKit.PDFDocument,
  record: JornadaPdfRecord,
  index: number,
  y: number,
) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const rowHeight = 72;
  const user = getUserLabel(record);
  const details = [
    `Data: ${formatDate(record.createdAt)}`,
    `Duracao: ${record.duracaoCalculada ?? "-"}`,
    record.intervalo ? `Intervalo: ${record.intervalo}` : null,
    record.codigo ? `Codigo: ${record.codigo}` : null,
    `Usuario: ${user}`,
  ].filter(Boolean);

  doc
    .roundedRect(margin, y, width, rowHeight, 10)
    .fillAndStroke(index % 2 === 0 ? "#ffffff" : "#f8fafc", "#e2e8f0");
  doc
    .roundedRect(margin + 14, y + 18, 30, 30, 15)
    .fill("#dbeafe");
  doc
    .fillColor("#1d4ed8")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(String(index + 1).padStart(2, "0"), margin + 14, y + 28, {
      width: 30,
      align: "center",
    });

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(record.horariosNormalizado, margin + 58, y + 17, {
      width: 170,
      ellipsis: true,
    });
  doc
    .fillColor("#64748b")
    .font("Helvetica")
    .fontSize(8)
    .text(record.mensagem.replace(/^Jornada valida:?\s*/i, ""), margin + 58, y + 39, {
      width: 170,
      height: 22,
      ellipsis: true,
    });

  doc
    .fillColor("#334155")
    .font("Helvetica")
    .fontSize(8.5)
    .text(details.join("  |  "), margin + 240, y + 17, {
      width: 176,
      height: 42,
      ellipsis: true,
    });

  doc
    .roundedRect(margin + width - 74, y + 22, 56, 24, 12)
    .fill("#dcfce7");
  doc
    .fillColor("#166534")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("VALIDA", margin + width - 74, y + 30, {
      width: 56,
      align: "center",
    });
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;

  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .moveTo(margin, 772)
      .lineTo(margin + width, 772)
      .strokeColor("#e2e8f0")
      .stroke();
    doc
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text("Perfect Utilitares", margin, 782, { width: 180 })
      .text(`Pagina ${i + 1} de ${range.count}`, margin, 782, {
        align: "right",
        width,
      });
  }
}

export function generateJornadaHistoryPdf(records: JornadaPdfRecord[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: "Relatorio de Jornadas",
        Author: "Perfect Utilitares",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    drawHeader(doc, records);

    let y = 248;
    drawTableHeader(doc, y);
    y += 34;

    records.forEach((record, index) => {
      if (y > 690) {
        doc.addPage();
        y = 54;
        drawTableHeader(doc, y);
        y += 34;
      }

      drawRecordRow(doc, record, index, y);
      y += 80;
    });

    drawFooter(doc);

    doc.end();
  });
}
