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

export type JornadaPdfEntry = {
  nome: string;
  matricula: string;
  dataAlteracao: string;
  records: JornadaPdfRecord[];
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

function formatInputDate(value: string) {
  if (!value) {
    return "____/____/________";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function sortRecords(records: JornadaPdfRecord[]) {
  return [...records].sort((a, b) => {
    const order = (value: string) => (value === "sabado" ? 2 : 1);
    return order(a.tipoDia) - order(b.tipoDia);
  });
}

function joinUnique(values: Array<string | null | undefined>, fallback = "-") {
  const unique = [...new Set(values.filter(Boolean) as string[])];
  return unique.length ? unique.join(" + ") : fallback;
}

function getEntryHorarios(entry: JornadaPdfEntry) {
  const records = sortRecords(entry.records);
  return records
    .map((record) =>
      record.tipoDia === "sabado"
        ? `Sábado: ${record.horariosNormalizado}`
        : record.horariosNormalizado,
    )
    .join(" + ");
}

function getEntryCodigo(entry: JornadaPdfEntry) {
  return joinUnique(entry.records.map((record) => record.codigo));
}

function getEntryDuracao(entry: JornadaPdfEntry) {
  return joinUnique(entry.records.map((record) => record.duracaoCalculada));
}

function getEntryPeriodo(entry: JornadaPdfEntry) {
  const dates = entry.records
    .map((record) => record.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) {
    return "-";
  }

  const first = formatDateOnly(dates[0]);
  const last = formatDateOnly(dates[dates.length - 1]);
  return first === last ? first : `${first} a ${last}`;
}

function drawHeader(doc: PDFKit.PDFDocument, entries: JornadaPdfEntry[]) {
  const { width } = doc.page;
  const margin = doc.page.margins.left;
  const contentWidth = width - margin * 2;
  const horarioCount = new Set(
    entries.map((entry) => `${getEntryHorarios(entry)}:${getEntryCodigo(entry)}`),
  ).size;

  doc
    .roundedRect(margin, 34, contentWidth, 94, 16)
    .fillAndStroke("#13231f", "#13231f");
  doc
    .fillColor("#f5c542")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PERFECTUTILITARES", margin + 22, 52, {
      characterSpacing: 0.8,
    });
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(24)
    .text("Alteração de Jornada", margin + 22, 70, {
      width: contentWidth - 44,
    });
  doc
    .fillColor("#d7e5df")
    .font("Helvetica")
    .fontSize(9)
    .text(`Gerado em ${formatDate(new Date())}`, margin + 22, 103, {
      width: contentWidth - 44,
    });

  const cardY = 146;
  const gap = 12;
  const cardWidth = (contentWidth - gap * 2) / 3;
  drawSummaryCard(doc, margin, cardY, cardWidth, "Pessoas", entries.length);
  drawSummaryCard(
    doc,
    margin + cardWidth + gap,
    cardY,
    cardWidth,
    "Horários",
    horarioCount,
  );
  drawSummaryCard(
    doc,
    margin + (cardWidth + gap) * 2,
    cardY,
    cardWidth,
    "Finalidade",
    "Alteração",
  );

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Dados para alteração", margin, 224);
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
    .fontSize(14)
    .text(String(value), x + 12, y + 28, { width: width - 24 });
}

function drawEntry(doc: PDFKit.PDFDocument, entry: JornadaPdfEntry, index: number, y: number) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const rowHeight = 126;
  const horario = getEntryHorarios(entry);
  const codigo = getEntryCodigo(entry);

  doc
    .roundedRect(margin, y, width, rowHeight, 12)
    .fillAndStroke(index % 2 === 0 ? "#ffffff" : "#f8fafc", "#d9e2ec");

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`${index + 1}. ${entry.nome || "Nome: ______________________________"}`, margin + 16, y + 15, {
      width: 255,
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(`Matrícula: ${entry.matricula || "________________"}`, margin + 16, y + 36, {
      width: 180,
    })
    .text(`Data de alteração: ${formatInputDate(entry.dataAlteracao)}`, margin + 220, y + 36, {
      width: 180,
    });

  doc
    .roundedRect(margin + width - 132, y + 15, 116, 30, 10)
    .fill("#ecfccb");
  doc
    .fillColor("#3f6212")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`Código: ${codigo}`, margin + width - 124, y + 25, {
      width: 100,
      align: "center",
      ellipsis: true,
    });

  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("HORÁRIO VALIDADO", margin + 16, y + 64);
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(horario, margin + 16, y + 78, {
      width: width - 32,
      height: 32,
      ellipsis: true,
    });

  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Duração: ${getEntryDuracao(entry)}   |   Validação: ${getEntryPeriodo(entry)}`,
      margin + 16,
      y + 106,
      { width: width - 32 },
    );
}

function drawSignature(doc: PDFKit.PDFDocument, y: number) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const lineWidth = 230;
  const x = margin + (width - lineWidth) / 2;

  doc
    .moveTo(x, y)
    .lineTo(x + lineWidth, y)
    .strokeColor("#334155")
    .stroke();
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Assinatura da Gerência", x, y + 9, {
      width: lineWidth,
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
      .text("PerfectUtilitares", margin, 782, { width: 180 })
      .text(`Página ${i + 1} de ${range.count}`, margin, 782, {
        align: "right",
        width,
      });
  }
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

    drawHeader(doc, entries);

    let y = 248;
    entries.forEach((entry, index) => {
      if (y > 640) {
        doc.addPage();
        y = 54;
      }

      drawEntry(doc, entry, index, y);
      y += 140;
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
