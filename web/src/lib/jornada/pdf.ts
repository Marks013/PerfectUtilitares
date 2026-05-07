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

function addField(doc: PDFKit.PDFDocument, label: string, value?: string | number | null) {
  doc
    .font("Helvetica-Bold")
    .text(`${label}: `, { continued: true })
    .font("Helvetica")
    .text(value == null || value === "" ? "____________________________" : String(value));
}

export function generateJornadaHistoryPdf(records: JornadaPdfRecord[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: "Relatorio de Jornadas",
        Author: "Projeto Web",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.font("Helvetica-Bold").fontSize(18).text("Relatorio de Jornadas");
    doc
      .moveDown(0.4)
      .font("Helvetica")
      .fontSize(10)
      .text(`Gerado em ${formatDate(new Date())}`)
      .text(`${records.length} jornada(s) selecionada(s)`);

    records.forEach((record, index) => {
      if (index > 0) doc.addPage();

      doc.moveDown(1);
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(`Jornada ${index + 1}`, { underline: true });
      doc.moveDown(0.5).fontSize(10);

      addField(doc, "Colaborador");
      addField(doc, "Matrícula");
      addField(doc, "Cargo");
      addField(doc, "Data de alteração");
      doc.moveDown(0.5);

      addField(doc, "Data da validação", formatDate(record.createdAt));
      addField(doc, "Horários digitados", record.horariosOriginal);
      addField(doc, "Horários normalizados", record.horariosNormalizado);
      addField(doc, "Código", record.codigo);
      addField(doc, "Duração", record.duracaoCalculada);
      addField(doc, "Intervalo", record.intervalo);
      addField(doc, "Tipo de dia", record.tipoDia);
      addField(doc, "Horas semanais", record.horasSemanais);
      addField(doc, "Horas mensais", record.horasMensais);
      addField(doc, "Usuário", record.user?.name ?? record.user?.email ?? null);

      doc.moveDown(0.6);
      doc
        .font("Helvetica-Bold")
        .fillColor(record.valido ? "#166534" : "#991b1b")
        .text(record.valido ? "Resultado: Valida" : "Resultado: Invalida");
      doc
        .fillColor("#111827")
        .font("Helvetica")
        .text(record.mensagem, { width: 500 });
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6b7280")
        .text(`Pagina ${i + 1} de ${range.count}`, 48, 800, {
          align: "center",
          width: 500,
        })
        .fillColor("#111827");
    }

    doc.end();
  });
}
