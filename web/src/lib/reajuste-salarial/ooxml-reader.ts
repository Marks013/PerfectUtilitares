import { unzipSync } from "fflate";
import { SalaryAdjustmentError } from "./errors";

export type PayrollWorkbookSheet = {
  sheet: string;
  data: unknown[][];
};

function xmlText(bytes: Uint8Array | undefined, path: string) {
  if (!bytes) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      `A planilha XLSX está incompleta: ${path} não foi encontrado.`,
    );
  }
  return new TextDecoder().decode(bytes);
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attributes(source: string) {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    result.set(match[1], decodeXml(match[2]));
  }
  return result;
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function richText(source: string) {
  return [...source.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function sharedStrings(entries: Record<string, Uint8Array>) {
  const bytes = entries["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = xmlText(bytes, "xl/sharedStrings.xml");
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(
    (match) => richText(match[1]),
  );
}

function cellValue(source: string, type: string | undefined, shared: string[]) {
  if (type === "inlineStr") return richText(source);
  const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(source)?.[1];
  if (raw === undefined) return null;
  const value = decodeXml(raw);
  if (type === "s") return shared[Number(value)] ?? "";
  if (type === "str" || type === "e") return value;
  if (type === "b") return value === "1";
  if (/^0\d+$/.test(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function parseSheet(xml: string, shared: string[]) {
  const rows: unknown[][] = [];
  for (const rowMatch of xml.matchAll(
    /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g,
  )) {
    const rowAttributes = attributes(rowMatch[1]);
    const rowNumber = Number(rowAttributes.get("r"));
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) continue;
    const row: unknown[] = [];
    for (const cellMatch of rowMatch[2].matchAll(
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
    )) {
      const cellAttributes = attributes(cellMatch[1]);
      const index = columnIndex(cellAttributes.get("r") ?? "");
      if (index < 0) continue;
      row[index] = cellValue(
        cellMatch[2] ?? "",
        cellAttributes.get("t"),
        shared,
      );
    }
    rows[rowNumber - 1] = row;
  }
  return rows;
}

function sheetPath(target: string) {
  const candidate = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target}`;
  const segments = candidate.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      "A planilha possui uma referência interna inválida.",
    );
  }
  return segments.join("/");
}

export function readPayrollWorkbookSheets(bytes: Buffer): PayrollWorkbookSheet[] {
  const entries = unzipSync(bytes);
  const workbookXml = xmlText(entries["xl/workbook.xml"], "xl/workbook.xml");
  const relationsXml = xmlText(
    entries["xl/_rels/workbook.xml.rels"],
    "xl/_rels/workbook.xml.rels",
  );
  const relations = new Map<string, string>();
  for (const match of relationsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
    const relation = attributes(match[1]);
    const id = relation.get("Id");
    const target = relation.get("Target");
    if (id && target) relations.set(id, sheetPath(target));
  }
  const shared = sharedStrings(entries);
  const sheets: PayrollWorkbookSheet[] = [];
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)>/g)) {
    const sheet = attributes(match[1]);
    const name = sheet.get("name");
    const relationId = sheet.get("r:id");
    const path = relationId ? relations.get(relationId) : undefined;
    if (!name || !path) continue;
    sheets.push({
      sheet: name,
      data: parseSheet(xmlText(entries[path], path), shared),
    });
  }
  if (sheets.length === 0) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      "A planilha XLSX não possui abas legíveis.",
    );
  }
  return sheets;
}
