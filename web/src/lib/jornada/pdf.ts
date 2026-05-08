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

type JornadaPdfPerson = {
  nome: string;
  matricula: string;
};

type JornadaPdfGroup = {
  dataAlteracao: string;
  records: JornadaPdfRecord[];
  people: JornadaPdfPerson[];
};

export type JornadaPdfDebugGroup = {
  dataAlteracao: string;
  horarios: string;
  codigo: string;
  peopleCount: number;
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
  return getRecordsCodigo(entry.records);
}

function getRecordsCodigo(records: JornadaPdfRecord[]) {
  const sorted = sortRecords(records);

  if (sorted.length <= 1) {
    return joinUnique(sorted.map((record) => record.codigo));
  }

  return sorted
    .map((record) => {
      const label = record.tipoDia === "sabado" ? "Sábado" : "Segunda a sexta";
      return `${label}: ${record.codigo ?? "-"}`;
    })
    .join(" | ");
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

function groupEntries(entries: JornadaPdfEntry[]): JornadaPdfGroup[] {
  const groups = new Map<string, JornadaPdfGroup>();

  entries.forEach((entry) => {
    const records = sortRecords(entry.records);
    const key = [
      getEntryHorarios(entry),
      getEntryCodigo(entry),
      entry.dataAlteracao,
    ].join("::");
    const group =
      groups.get(key) ??
      {
        dataAlteracao: entry.dataAlteracao,
        records,
        people: [],
      };

    group.people.push({
      nome: entry.nome,
      matricula: entry.matricula,
    });
    groups.set(key, group);
  });

  return [...groups.values()].sort((a, b) => {
    const horarioCompare = getGroupHorarios(a).localeCompare(
      getGroupHorarios(b),
      "pt-BR",
    );
    if (horarioCompare !== 0) {
      return horarioCompare;
    }

    return a.dataAlteracao.localeCompare(b.dataAlteracao);
  });
}

export function getJornadaPdfDebugGroups(
  entries: JornadaPdfEntry[],
): JornadaPdfDebugGroup[] {
  return groupEntries(entries).map((group) => ({
    dataAlteracao: group.dataAlteracao,
    horarios: getGroupHorarios(group),
    codigo: getGroupCodigo(group),
    peopleCount: group.people.length,
  }));
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  groups: JornadaPdfGroup[],
  totalPeople: number,
) {
  const { width } = doc.page;
  const margin = doc.page.margins.left;
  const contentWidth = width - margin * 2;
  const horarioCount = groups.length;

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

function getGroupHorarios(group: JornadaPdfGroup) {
  return getEntryHorarios({
    nome: "",
    matricula: "",
    dataAlteracao: group.dataAlteracao,
    records: group.records,
  });
}

function getGroupCodigo(group: JornadaPdfGroup) {
  return getRecordsCodigo(group.records);
}

function getGroupDuracao(group: JornadaPdfGroup) {
  return joinUnique(group.records.map((record) => record.duracaoCalculada));
}

function getGroupPeriodo(group: JornadaPdfGroup) {
  return getEntryPeriodo({
    nome: "",
    matricula: "",
    dataAlteracao: group.dataAlteracao,
    records: group.records,
  });
}

function getGroupHeight(group: JornadaPdfGroup) {
  return 128 + Math.max(1, group.people.length) * 18;
}

function drawGroup(
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

  doc
    .roundedRect(margin, y, width, rowHeight, 12)
    .fillAndStroke(index % 2 === 0 ? "#ffffff" : "#f8fafc", "#d9e2ec");

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`Grupo ${index + 1}`, margin + 16, y + 14, {
      width: 120,
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(`Data de alteração: ${formatInputDate(group.dataAlteracao)}`, margin + 100, y + 16, {
      width: 190,
    });

  doc
    .roundedRect(margin + width - 220, y + 12, 204, 32, 10)
    .fill("#ecfccb");
  doc
    .fillColor("#3f6212")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(`Código: ${codigo}`, margin + width - 212, y + 21, {
      width: 188,
      align: "center",
      ellipsis: true,
    });

  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("HORÁRIO VALIDADO", margin + 16, y + 58);
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(horario, margin + 16, y + 72, {
      width: width - 32,
      height: 32,
      ellipsis: true,
    });

  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Duração: ${getGroupDuracao(group)}   |   Validação: ${getGroupPeriodo(group)}`,
      margin + 16,
      y + 100,
      { width: width - 32 },
    );

  const peopleY = y + 124;
  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("COLABORADORES", margin + 16, peopleY - 13);

  group.people.forEach((person, personIndex) => {
    const rowY = peopleY + personIndex * 18;
    const rowText = `${personIndex + 1}. ${person.nome}`;
    doc
      .fillColor("#0f172a")
      .font("Helvetica")
      .fontSize(9.2)
      .text(rowText, margin + 16, rowY, { width: width - 190, ellipsis: true });
    doc
      .fillColor("#475569")
      .fontSize(8.8)
      .text(
        person.matricula ? `Matrícula: ${person.matricula}` : "Matrícula: -",
        margin + width - 170,
        rowY,
        { width: 154, align: "right", ellipsis: true },
      );
  });
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

    const groups = groupEntries(entries);
    drawHeader(doc, groups, entries.length);

    let y = 248;
    groups.forEach((group, index) => {
      const groupHeight = getGroupHeight(group);
      if (y + groupHeight > 730) {
        doc.addPage();
        y = 54;
      }

      drawGroup(doc, group, index, y);
      y += groupHeight + 14;
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
