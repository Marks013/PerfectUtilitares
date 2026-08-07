import {
  formatDate,
  formatInputDate,
  getGroupCodigo,
  getGroupDuracao,
  getGroupHeight,
  getGroupHorarios,
  getGroupPeriodo,
  type JornadaPdfGroup,
} from "./pdf-history-data";

export function drawHeader(
  doc: PDFKit.PDFDocument,
  groups: JornadaPdfGroup[],
  totalPeople: number,
) {
  const { width } = doc.page;
  const margin = doc.page.margins.left;
  const contentWidth = width - margin * 2;
  const horarioCount = groups.length;

  doc
    .roundedRect(margin, 34, contentWidth, 70, 14)
    .fillAndStroke("#13231f", "#13231f");
  doc
    .fillColor("#f5c542")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PERFECTUTILITARES", margin + 18, 48, {
      characterSpacing: 0.8,
    });
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(21)
    .text("Alteração de Jornada", margin + 18, 64, {
      width: contentWidth - 36,
    });
  doc
    .fillColor("#d7e5df")
    .font("Helvetica")
    .fontSize(9)
    .text(`Gerado em ${formatDate(new Date())}`, margin + 18, 88, {
      width: contentWidth - 36,
    });

  const cardY = 118;
  const gap = 12;
  const cardWidth = (contentWidth - gap * 2) / 3;
  drawSummaryCard(doc, margin, cardY, cardWidth, "Pessoas", totalPeople);
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
    .text("Dados para alteração", margin, 184);
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
    .roundedRect(x, y, width, 42, 9)
    .fillAndStroke("#f8fafc", "#dbe4ef");
  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label.toUpperCase(), x + 12, y + 8, { width: width - 24 });
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(String(value), x + 12, y + 23, { width: width - 24 });
}

export function drawGroup(
  doc: PDFKit.PDFDocument,
  group: JornadaPdfGroup,
  index: number,
  y: number,
) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const rowHeight = getGroupHeight(group);
  const horario = getGroupHorarios(group);
  const codigo = getGroupCodigo(group);
  const headerY = y + 10;
  const scheduleY = y + 37;
  const peopleY = y + 70;
  const nameWidth = width - 190;

  doc
    .roundedRect(margin, y, width, rowHeight, 11)
    .fillAndStroke("#ffffff", index % 2 === 0 ? "#d9e2ec" : "#cbd5e1");

  doc
    .roundedRect(margin, y, 7, rowHeight, 4)
    .fill(index % 2 === 0 ? "#14b8a6" : "#fb6f4f");

  doc
    .roundedRect(margin + 14, headerY - 2, 68, 20, 8)
    .fill("#13231f");
  doc
    .fillColor("#ffffff")
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor("#ffffff")
    .text(`Grupo ${index + 1}`, margin + 23, headerY + 4, {
      width: 50,
      align: "center",
    });

  doc
    .roundedRect(margin + 92, headerY - 2, 150, 20, 8)
    .fill("#fef3c7");
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor("#92400e")
    .text(`Alteração: ${formatInputDate(group.dataAlteracao)}`, margin + 102, headerY + 4, {
      width: 130,
      ellipsis: true,
    });

  doc
    .roundedRect(margin + width - 246, headerY - 2, 230, 20, 8)
    .fill("#ecfccb");
  doc
    .fillColor("#3f6212")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(`Código: ${codigo}`, margin + width - 236, headerY + 4, {
      width: 210,
      align: "right",
      ellipsis: true,
    });

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11.5)
    .text(horario, margin + 16, scheduleY, {
      width: width - 32,
      height: 15,
      ellipsis: true,
    });

  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(8)
    .text(
      `Duração: ${getGroupDuracao(group)}   |   Validação: ${getGroupPeriodo(group)}`,
      margin + 16,
      scheduleY + 15,
      { width: width - 32 },
    );

  doc
    .roundedRect(margin + 16, peopleY - 5, width - 32, 17, 6)
    .fill("#f1f5f9");
  doc
    .fillColor("#334155")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("COLABORADOR", margin + 26, peopleY, { width: nameWidth - 10 })
    .text("MATRÍCULA", margin + 26 + nameWidth, peopleY, {
      width: 130,
      align: "right",
    });

  group.people.forEach((person, personIndex) => {
    const rowY = peopleY + 17 + personIndex * 15;
    const isEvenRow = personIndex % 2 === 0;

    if (isEvenRow) {
      doc
        .roundedRect(margin + 16, rowY - 3, width - 32, 14, 5)
        .fill("#f8fafc");
    }

    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(9.3)
      .text(`${personIndex + 1}. ${person.nome}`, margin + 26, rowY, {
        width: nameWidth - 10,
        ellipsis: true,
      });
    doc
      .fillColor(person.matricula ? "#0f172a" : "#94a3b8")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(
        person.matricula || "-",
        margin + 26 + nameWidth,
        rowY,
        { width: 130, align: "right", ellipsis: true },
      );
  });
}

export function drawSignature(doc: PDFKit.PDFDocument, y: number) {
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

export function drawFooter(doc: PDFKit.PDFDocument) {
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

