import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  MAX_TEMPLATE_BYTES,
  MAX_XML_BYTES,
  TEMPLATE_DEFINITIONS,
  UnimedDocumentError,
  type GeneratedDocumentKind,
  type MergeValues,
} from "./document-core";

const PRODUCTION_TEMPLATE_PATHS: Record<GeneratedDocumentKind, string> = {
  RN561: "/data/unimed-templates/MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
  INACTIVE_TERM: "/data/unimed-templates/MODELO_TERMO_INATIVO.docx",
};

type FieldState = {
  instruction: string;
  fieldName: string | null;
  value: string;
  inResult: boolean;
  wroteResult: boolean;
};

function normalizeFieldName(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

function decodeXmlText(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeXmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function mergeFieldName(instruction: string) {
  const decoded = decodeXmlText(instruction).replace(/\s+/g, " ").trim();
  const match = decoded.match(/\bMERGEFIELD\s+(?:"([^"]+)"|([^\s\\]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function replaceMergeFieldResults(
  xml: string,
  expectedFields: readonly string[],
  values: MergeValues,
) {
  const expected = new Map(
    expectedFields.map((field) => [normalizeFieldName(field), field]),
  );
  const normalizedValues = new Map(
    Object.entries(values).map(([field, value]) => [
      normalizeFieldName(field),
      value,
    ]),
  );
  const seen = new Set<string>();
  const stack: FieldState[] = [];
  const tokenPattern =
    /<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?\s*>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

  const rendered = xml.replace(
    tokenPattern,
    (
      token,
      fieldMarker: string | undefined,
      instruction: string | undefined,
      textAttributes: string | undefined,
    ) => {
      if (fieldMarker === "begin") {
        stack.push({
          instruction: "",
          fieldName: null,
          value: "",
          inResult: false,
          wroteResult: false,
        });
        return token;
      }

      const current = stack.at(-1);
      if (!current) return token;

      if (instruction !== undefined && !current.inResult) {
        current.instruction += decodeXmlText(instruction);
        return token;
      }

      if (fieldMarker === "separate") {
        const fieldName = mergeFieldName(current.instruction);
        if (fieldName) {
          const normalized = normalizeFieldName(fieldName);
          current.fieldName = normalized;
          current.value = normalizedValues.get(normalized) ?? "";
          seen.add(normalized);
        }
        current.inResult = true;
        return token;
      }

      if (fieldMarker === "end") {
        stack.pop();
        return token;
      }

      if (
        textAttributes !== undefined &&
        current.inResult &&
        current.fieldName &&
        expected.has(current.fieldName)
      ) {
        const value = current.wroteResult ? "" : current.value;
        current.wroteResult = true;
        return `<w:t${textAttributes}>${escapeXmlText(value)}</w:t>`;
      }

      return token;
    },
  );

  return { rendered, seen };
}

function removeMailMergeConfiguration(xml: string) {
  return xml.replace(/<w:mailMerge\b[\s\S]*?<\/w:mailMerge>/g, "");
}

function removeMailMergeRelationships(xml: string) {
  return xml.replace(
    /<Relationship\b(?=[^>]*Type="[^"]*\/mailMergeSource")[^>]*\/>/g,
    "",
  );
}

export async function renderUnimedDocumentTemplate(
  template: Uint8Array,
  kind: GeneratedDocumentKind,
  values: MergeValues,
) {
  const definition = TEMPLATE_DEFINITIONS[kind];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(template, { checkCRC32: true });
  } catch {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_INVALID", 503);
  }

  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_INVALID", 503);
  }

  const seen = new Set<string>();
  const xmlParts = Object.keys(zip.files).filter((name) =>
    /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name),
  );
  for (const partName of xmlParts) {
    const part = zip.file(partName);
    if (!part) continue;
    const xml = await part.async("string");
    if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
      throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_INVALID", 503);
    }
    const result = replaceMergeFieldResults(xml, definition.fields, values);
    result.seen.forEach((field) => {
      seen.add(field);
    });
    zip.file(partName, result.rendered);
  }

  const expected = new Set(definition.fields.map(normalizeFieldName));
  if (
    seen.size !== expected.size ||
    [...seen].some((field) => !expected.has(field))
  ) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_INVALID", 503);
  }

  const settings = zip.file("word/settings.xml");
  if (settings) {
    const xml = await settings.async("string");
    zip.file("word/settings.xml", removeMailMergeConfiguration(xml));
  }

  const settingsRelationships = zip.file("word/_rels/settings.xml.rels");
  if (settingsRelationships) {
    const xml = await settingsRelationships.async("string");
    zip.file("word/_rels/settings.xml.rels", removeMailMergeRelationships(xml));
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function templatePath(kind: GeneratedDocumentKind) {
  if (process.env.NODE_ENV === "production") {
    return PRODUCTION_TEMPLATE_PATHS[kind];
  }

  const definition = TEMPLATE_DEFINITIONS[kind];
  const root = process.env.UNIMED_TEMPLATE_DIR?.trim();
  if (root) {
    return path.join(/*turbopackIgnore: true*/ root, definition.fileName);
  }

  throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_NOT_CONFIGURED", 503);
}

export async function loadVerifiedTemplate(kind: GeneratedDocumentKind) {
  const definition = TEMPLATE_DEFINITIONS[kind];
  let size: number;
  let template: Buffer;
  try {
    const filePath = templatePath(kind);
    const metadata = await stat(/*turbopackIgnore: true*/ filePath);
    size = metadata.size;
    if (!metadata.isFile() || size <= 0 || size > MAX_TEMPLATE_BYTES) {
      throw new Error("invalid template metadata");
    }
    template = await readFile(/*turbopackIgnore: true*/ filePath);
  } catch (error) {
    if (error instanceof UnimedDocumentError) throw error;
    throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_UNAVAILABLE", 503);
  }

  const sha256 = createHash("sha256").update(template).digest("hex");
  if (sha256 !== definition.sha256) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_UNVERIFIED", 503);
  }
  return template;
}

