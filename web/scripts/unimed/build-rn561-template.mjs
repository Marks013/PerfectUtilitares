import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ORIGINAL_SHA256 =
  "ab93d1bc9403250e11c10b876b146146698b85f261d60671ad3c8b5faa1733ab";
const DEFAULT_SOURCE =
  "G:/Samuel/00 - UNIMED/MODELO_RN561_FORMULARIO _EXCLUSAO.docx";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(
  scriptDirectory,
  "templates",
  "MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneDependentRow(row, dependentNumber) {
  const suffix = String(dependentNumber);
  return row
    .replaceAll("DEPENDENTE4", `DEPENDENTE${suffix}`)
    .replaceAll("CPF4", `CPF${suffix}`)
    .replaceAll('w14:paraId="6E2BFB4A"', `w14:paraId="6E2BFB4${suffix}"`)
    .replaceAll('w14:paraId="10C78E18"', `w14:paraId="10C78E1${suffix}"`)
    .replaceAll('w14:paraId="3203AC52"', `w14:paraId="3203AC5${suffix}"`)
    .replaceAll('w14:paraId="52A2D9A7"', `w14:paraId="52A2D9A${suffix}"`)
    .replaceAll('w14:paraId="78E18880"', `w14:paraId="78E1888${suffix}"`)
    .replaceAll('w14:paraId="4C84B894"', `w14:paraId="4C84B89${suffix}"`);
}

function compactDependentRow(row) {
  return row
    .replace(/<w:trHeight w:val="\d+"\/>/, '<w:trHeight w:val="280"/>')
    .replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) =>
      paragraph.includes("<w:r") ? paragraph : "",
    );
}

function addDependentRows(documentXml) {
  if (documentXml.includes('MERGEFIELD "DEPENDENTE5"')) {
    throw new Error("O modelo de origem já contém DEPENDENTE5.");
  }

  const rows = [...documentXml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];
  const dependentRows = rows.filter((match) =>
    /MERGEFIELD "DEPENDENTE[1-4]"/.test(match[0]),
  );
  const source = dependentRows.find((match) =>
    match[0].includes('MERGEFIELD "DEPENDENTE4"'),
  );
  if (!source) {
    throw new Error("Linha de DEPENDENTE4 não encontrada no modelo RN561.");
  }
  if (dependentRows.length !== 4) {
    throw new Error(
      `Esperadas 4 linhas de dependentes; encontradas ${dependentRows.length}.`,
    );
  }

  const compactSource = compactDependentRow(source[0]);
  const extraRows = [5, 6]
    .map((number) => cloneDependentRow(compactSource, number))
    .join("");
  let output = documentXml;
  for (const dependentRow of dependentRows) {
    const compact = compactDependentRow(dependentRow[0]);
    output = output.replace(
      dependentRow[0],
      dependentRow === source ? `${compact}${extraRows}` : compact,
    );
  }
  return output;
}

function fixFooter(footerXml) {
  const replacements = [
    [
      "<wp:posOffset>6328659</wp:posOffset>",
      "<wp:posOffset>6096000</wp:posOffset>",
    ],
    [
      "<wp:posOffset>9454794</wp:posOffset>",
      "<wp:posOffset>9284000</wp:posOffset>",
    ],
    ["margin-left:498.3pt", "margin-left:480pt"],
    ["margin-top:744.45pt", "margin-top:731.02pt"],
  ];

  let output = footerXml;
  for (const [from, to] of replacements) {
    if (!output.includes(from)) {
      throw new Error(`Geometria esperada do rodapé não encontrada: ${from}`);
    }
    output = output.replace(from, to);
  }
  return output;
}

function unifyDocumentSections(documentXml) {
  const sections = [
    ...documentXml.matchAll(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g),
  ];
  if (sections.length !== 2) {
    throw new Error(
      `Esperadas 2 seções no RN561; encontradas ${sections.length}.`,
    );
  }

  const first = sections[0][0];
  const last = sections[1][0];
  const header = first.match(/<w:headerReference[^>]*\/>/)?.[0];
  const footer = first.match(/<w:footerReference[^>]*\/>/)?.[0];
  if (!header || !footer) {
    throw new Error(
      "Referências de cabeçalho/rodapé da primeira seção não encontradas.",
    );
  }

  const unifiedLast = last.replace(
    /^(<w:sectPr(?:\s[^>]*)?>)/,
    `$1${header}${footer}`,
  );
  return documentXml.replace(first, "").replace(last, unifiedLast);
}

const DATE_PLACEHOLDER = "______/______/________";

function fixDatePlaceholder(documentXml) {
  const paragraphs = [
    ...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
  ];
  const matches = paragraphs.filter(
    (match) =>
      match[0].includes("<w:t>DATA</w:t>") && match[0].includes("<w:t>/</w:t>"),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one RN561 DATA placeholder; found ${matches.length}.`,
    );
  }

  const paragraph = matches[0][0];
  const labelEnd = '<w:proofErr w:type="gramEnd"/>';
  const labelEndIndex = paragraph.indexOf(labelEnd);
  if (labelEndIndex < 0) {
    throw new Error("RN561 DATA label boundary was not found.");
  }
  const deterministicRun = [
    "<w:r>",
    '<w:rPr><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>',
    `<w:t xml:space="preserve"> ${DATE_PLACEHOLDER}</w:t>`,
    "</w:r>",
  ].join("");
  const fixedParagraph =
    paragraph.slice(0, labelEndIndex + labelEnd.length) +
    deterministicRun +
    "</w:p>";
  const output = documentXml.replace(paragraph, fixedParagraph);
  if ((output.match(new RegExp(DATE_PLACEHOLDER, "g")) ?? []).length !== 1) {
    throw new Error(
      "RN561 DATA placeholder replacement was not deterministic.",
    );
  }
  return output;
}

function compactContinuation(documentXml) {
  const marker = "A partir da data, hora e minuto da exclusão";
  const markerIndex = documentXml.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Início da continuação do termo RN561 não encontrado.");
  }

  let leadRemoved = 0;
  const before = documentXml
    .slice(0, markerIndex)
    .replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
      if (!paragraph.includes("<w:r") && paragraph.includes("<w:spacing")) {
        leadRemoved += 1;
        return "";
      }
      return paragraph;
    });
  if (leadRemoved !== 2) {
    throw new Error(
      `Esperados 2 espaçadores antes da continuação: ${leadRemoved}.`,
    );
  }
  const after = documentXml.slice(markerIndex);
  let removed = 0;
  const compacted = after.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraph) => {
      if (!paragraph.includes("<w:r") && paragraph.includes("<w:spacing")) {
        removed += 1;
        return "";
      }
      return paragraph;
    },
  );
  if (removed < 3) {
    throw new Error(`Poucos espaçadores removidos da continuação: ${removed}.`);
  }
  return before + compacted;
}

async function main() {
  const sourcePath = path.resolve(process.argv[2] || DEFAULT_SOURCE);
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT);
  const source = await readFile(sourcePath);
  const sourceHash = sha256(source);
  if (sourceHash !== ORIGINAL_SHA256) {
    throw new Error(
      `Modelo RN561 de origem não aprovado: ${sourceHash}. Esperado: ${ORIGINAL_SHA256}.`,
    );
  }

  const zip = await JSZip.loadAsync(source, { checkCRC32: true });
  const documentPart = zip.file("word/document.xml");
  const footerPart = zip.file("word/footer1.xml");
  if (!documentPart || !footerPart) {
    throw new Error("Modelo RN561 sem document.xml ou footer1.xml.");
  }

  const documentXml = fixDatePlaceholder(
    compactContinuation(
      unifyDocumentSections(
        addDependentRows(await documentPart.async("string")),
      ),
    ),
  );
  zip.file("word/document.xml", documentXml, { date: documentPart.date });
  zip.file("word/footer1.xml", fixFooter(await footerPart.async("string")), {
    date: footerPart.date,
  });

  const stableTimestamp = new Date("2026-07-30T00:00:00.000Z");
  for (const entry of Object.values(zip.files)) {
    entry.date = stableTimestamp;
  }

  const output = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  process.stdout.write(
    JSON.stringify(
      {
        source: sourcePath,
        sourceSha256: sourceHash,
        output: outputPath,
        outputSha256: sha256(output),
        bytes: output.length,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
