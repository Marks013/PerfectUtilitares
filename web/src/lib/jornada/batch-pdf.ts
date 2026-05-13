import PDFDocument from "pdfkit";
import type { JornadaBatchLine, JornadaBatchReport } from "./batch-validation";

export type JornadaBatchPdfOptions = {
  detalhado?: boolean;
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function drawTextCell(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  options: PDFKit.Mixins.TextOptions = {},
) {
  doc.text(text || "-", x, y, {
    width,
    lineBreak: false,
    ellipsis: true,
    ...options,
  });
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;

  doc
    .roundedRect(margin, 34, width, 66, 12)
    .fillAndStroke("#13231f", "#13231f");
  doc
    .fillColor("#f5c542")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PERFECTUTILITARES", margin + 18, 48);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("Relatório de Validação de Jornadas", margin + 18, 63, {
      width: width - 36,
    });
  doc
    .fillColor("#d7e5df")
    .font("Helvetica")
    .fontSize(9)
    .text(`Gerado em ${formatDateTime(new Date())}`, margin + 18, 86, {
      width: width - 36,
    });
}

function drawSummaryCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string | number,
  color = "#0f172a",
) {
  doc
    .roundedRect(x, y, width, 42, 9)
    .fillAndStroke("#f8fafc", "#dbe4ef");
  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(label.toUpperCase(), x + 10, y + 8, { width: width - 20 });
  doc
    .fillColor(color)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(String(value), x + 10, y + 23, { width: width - 20 });
}

function drawSummary(doc: PDFKit.PDFDocument, report: JornadaBatchReport, y: number) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const cardGap = 8;
  const cardWidth = (width - cardGap * 3) / 4;
  const successRate =
    report.totalLinhas > 0
      ? `${((report.validos * 100) / report.totalLinhas).toFixed(1)}%`
      : "0.0%";

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Resumo geral", margin, y);
  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(9)
    .text(`Arquivo: ${report.arquivoOrigem || "-"}`, margin, y + 18, {
      width: width / 2 - 8,
      lineBreak: false,
      ellipsis: true,
    })
    .text(`Planilha: ${report.nomePlanilha || "-"}`, margin + width / 2, y + 18, {
      width: width / 2,
      lineBreak: false,
      ellipsis: true,
    });

  const cardY = y + 42;
  drawSummaryCard(doc, margin, cardY, cardWidth, "Total", report.totalLinhas);
  drawSummaryCard(
    doc,
    margin + cardWidth + cardGap,
    cardY,
    cardWidth,
    "Validos",
    report.validos,
    "#166534",
  );
  drawSummaryCard(
    doc,
    margin + (cardWidth + cardGap) * 2,
    cardY,
    cardWidth,
    "Erros",
    report.erros,
    "#b91c1c",
  );
  drawSummaryCard(
    doc,
    margin + (cardWidth + cardGap) * 3,
    cardY,
    cardWidth,
    "Sucesso",
    successRate,
    report.erros === 0 ? "#166534" : "#92400e",
  );
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number) {
  if (y + needed <= 742) {
    return y;
  }

  doc.addPage();
  return 54;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  columns: Array<{ label: string; x: number; width: number }>,
) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;

  doc.roundedRect(margin, y - 5, width, 22, 6).fill("#e2e8f0");
  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8);
  columns.forEach((column) => {
    drawTextCell(doc, column.label, column.x, y + 1, column.width);
  });
}

export function formatBatchLineLabel(line: Pick<JornadaBatchLine, "matricula" | "nome">) {
  const matricula = line.matricula.trim();
  const nome = line.nome.trim();

  if (matricula && nome) return `${matricula} - ${nome}`;
  return nome || matricula || "-";
}

function batchLinePersonKey(line: Pick<JornadaBatchLine, "matricula" | "nome">) {
  return `${line.matricula.trim().toUpperCase()}|${line.nome.trim().toUpperCase()}`;
}

export function getBatchDetailedScheduleGroups(report: JornadaBatchReport) {
  const byPerson = new Map<
    string,
    { principal?: JornadaBatchLine; sabado?: JornadaBatchLine }
  >();

  report.linhas
    .filter((line) => line.jornadaCompleta && line.horarios.length >= 2)
    .forEach((line) => {
      const key = batchLinePersonKey(line);
      const current = byPerson.get(key) ?? {};

      if (line.linhaSabado) {
        current.sabado ??= line;
      } else {
        current.principal ??= line;
      }

      byPerson.set(key, current);
    });

  const collaborators = [...byPerson.values()].map((entry) => {
    const principal = entry.principal ?? entry.sabado;
    const sabado = entry.sabado;

    return {
      identificacao: principal ? formatBatchLineLabel(principal) : "-",
      nome: principal?.nome ?? "",
      matricula: principal?.matricula ?? "",
      horarioPrincipal: principal?.jornadaCompleta ?? "-",
      horarioSabado: sabado?.jornadaCompleta ?? "",
    };
  });

  const groups = new Map<string, typeof collaborators>();
  collaborators.forEach((collaborator) => {
    const list = groups.get(collaborator.horarioPrincipal) ?? [];
    list.push(collaborator);
    groups.set(collaborator.horarioPrincipal, list);
  });

  return [...groups.entries()]
    .map(([horarioPrincipal, colaboradores]) => ({
      horarioPrincipal,
      colaboradores: colaboradores.sort(
        (a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR") ||
          a.matricula.localeCompare(b.matricula, "pt-BR"),
      ),
    }))
    .sort(
      (a, b) =>
        b.colaboradores.length - a.colaboradores.length ||
        a.horarioPrincipal.localeCompare(b.horarioPrincipal, "pt-BR"),
    );
}

function drawErrors(doc: PDFKit.PDFDocument, report: JornadaBatchReport, y: number) {
  const errors = report.linhasComErro.slice(0, 50);
  if (errors.length === 0) {
    return y;
  }

  let currentY = ensureSpace(doc, y, 70);
  const margin = doc.page.margins.left;
  const nameWidth = 150;
  const scheduleWidth = 134;
  const errorWidth = doc.page.width - margin * 2 - nameWidth - scheduleWidth - 30;
  const columns = [
    { label: "Matrícula / Nome", x: margin + 10, width: nameWidth },
    { label: "Jornada", x: margin + 20 + nameWidth, width: scheduleWidth },
    {
      label: "Erro",
      x: margin + 30 + nameWidth + scheduleWidth,
      width: errorWidth,
    },
  ];

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`Detalhamento dos erros (${report.erros})`, margin, currentY);
  currentY += 24;
  drawTableHeader(doc, currentY, columns);
  currentY += 24;

  errors.forEach((line, index) => {
    currentY = ensureSpace(doc, currentY, 24);
    if (index % 2 === 0) {
      doc
        .roundedRect(margin, currentY - 4, doc.page.width - margin * 2, 20, 5)
        .fill("#f8fafc");
    }

    doc.fillColor("#0f172a").font("Helvetica").fontSize(8);
    drawTextCell(doc, formatBatchLineLabel(line), columns[0].x, currentY, columns[0].width);
    drawTextCell(
      doc,
      line.jornadaCompleta,
      columns[1].x,
      currentY,
      columns[1].width,
    );
    drawTextCell(
      doc,
      line.resultado?.mensagem ?? "Erro desconhecido",
      columns[2].x,
      currentY,
      columns[2].width,
    );
    currentY += 22;
  });

  if (report.linhasComErro.length > 50) {
    currentY = ensureSpace(doc, currentY, 18);
    doc
      .fillColor("#64748b")
      .font("Helvetica-Oblique")
      .fontSize(8.5)
      .text(`... e mais ${report.linhasComErro.length - 50} erros`, margin, currentY);
    currentY += 20;
  }

  return currentY + 8;
}

function drawFrequentSchedules(
  doc: PDFKit.PDFDocument,
  report: JornadaBatchReport,
  y: number,
) {
  const schedules = Object.entries(report.jornadasRepetidas)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (schedules.length === 0) {
    return y;
  }

  let currentY = ensureSpace(doc, y, 70);
  const margin = doc.page.margins.left;
  const countWidth = 86;
  const scheduleWidth = doc.page.width - margin * 2 - countWidth - 30;
  const columns = [
    { label: "Jornada", x: margin + 10, width: scheduleWidth },
    {
      label: "Colaboradores",
      x: margin + 20 + scheduleWidth,
      width: countWidth,
    },
  ];

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Jornadas mais frequentes", margin, currentY);
  currentY += 24;
  drawTableHeader(doc, currentY, columns);
  currentY += 24;

  schedules.forEach(([schedule, count], index) => {
    currentY = ensureSpace(doc, currentY, 22);
    if (index % 2 === 0) {
      doc
        .roundedRect(margin, currentY - 4, doc.page.width - margin * 2, 19, 5)
        .fill("#f8fafc");
    }

    doc.fillColor("#0f172a").font("Helvetica").fontSize(8.5);
    drawTextCell(doc, schedule, columns[0].x, currentY, columns[0].width);
    drawTextCell(
      doc,
      String(count),
      columns[1].x,
      currentY,
      columns[1].width,
      { align: "right" },
    );
    currentY += 21;
  });

  return currentY;
}

function drawDetailedSchedules(
  doc: PDFKit.PDFDocument,
  report: JornadaBatchReport,
  y: number,
) {
  const groups = getBatchDetailedScheduleGroups(report);
  if (groups.length === 0) {
    return y;
  }

  let currentY = ensureSpace(doc, y, 70);
  const margin = doc.page.margins.left;
  const personWidth = 168;
  const firstWidth = 128;
  const secondWidth = doc.page.width - margin * 2 - personWidth - firstWidth - 40;
  const columns = [
    { label: "Matrícula / Nome", x: margin + 10, width: personWidth },
    { label: "Horário 1", x: margin + 20 + personWidth, width: firstWidth },
    {
      label: "Horário 2 (Sábado)",
      x: margin + 30 + personWidth + firstWidth,
      width: secondWidth,
    },
  ];

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Relação detalhada de horários", margin, currentY);
  currentY += 24;

  groups.forEach((group) => {
    currentY = ensureSpace(doc, currentY, 62);
    doc
      .fillColor("#1e3a8a")
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(
        `${group.horarioPrincipal} - ${group.colaboradores.length}`,
        margin,
        currentY,
        { width: doc.page.width - margin * 2 },
      );
    currentY += 18;
    drawTableHeader(doc, currentY, columns);
    currentY += 24;

    group.colaboradores.forEach((collaborator, index) => {
      currentY = ensureSpace(doc, currentY, 24);
      if (index % 2 === 0) {
        doc
          .roundedRect(margin, currentY - 4, doc.page.width - margin * 2, 20, 5)
          .fill("#f8fafc");
      }

      doc.fillColor("#0f172a").font("Helvetica").fontSize(7.8);
      drawTextCell(
        doc,
        collaborator.identificacao,
        columns[0].x,
        currentY,
        columns[0].width,
      );
      drawTextCell(
        doc,
        collaborator.horarioPrincipal,
        columns[1].x,
        currentY,
        columns[1].width,
      );
      drawTextCell(
        doc,
        collaborator.horarioSabado || "-",
        columns[2].x,
        currentY,
        columns[2].width,
      );
      currentY += 22;
    });

    currentY += 8;
  });

  currentY = ensureSpace(doc, currentY, 18);
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`Total de validações - ${report.totalLinhas}`, margin, currentY);

  return currentY + 20;
}

function drawNoErrors(doc: PDFKit.PDFDocument, y: number) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const currentY = ensureSpace(doc, y, 48);

  doc.roundedRect(margin, currentY, width, 38, 9).fillAndStroke("#f0fdf4", "#bbf7d0");
  doc
    .fillColor("#166534")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Nenhum erro encontrado na planilha importada.", margin + 14, currentY + 13, {
      width: width - 28,
    });

  return currentY + 52;
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
