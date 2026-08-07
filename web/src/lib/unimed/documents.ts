import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { UnimedDocumentKind } from "@/generated/prisma/client";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 2 * 1024 * 1024;

const TEMPLATE_DEFINITIONS = {
  RN561: {
    fileName: "MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
    sha256: "c7d4c9a46a787c6ac70b1b3c22cb17e8176d94df7edc61026dddf559f99231fe",
    downloadName: "unimed-rn561.docx",
    fields: [
      "Razão_social",
      "ENDEREÇO",
      "Numero",
      "Bairro",
      "Cidade",
      "UF",
      "CNPJ",
      "Inscrição_Estadual",
      "Telefone",
      "NOME",
      "CPF",
      "DEPENDENTE1",
      "CPF1",
      "DEPENDENTE2",
      "CPF2",
      "DEPENDENTE3",
      "CPF3",
      "DEPENDENTE4",
      "CPF4",
      "DEPENDENTE5",
      "CPF5",
      "DEPENDENTE6",
      "CPF6",
    ],
  },
  INACTIVE_TERM: {
    fileName: "MODELO_TERMO_INATIVO.docx",
    sha256: "430f83b729b4e7fd1ab3bbebd6b7c59e570369434777d9f0178d37d221a46607",
    downloadName: "unimed-termo-inativo.docx",
    fields: [
      "TITULAR",
      "CPF",
      "RG",
      "ENDEREÇO",
      "Numero",
      "CEP",
      "MUNICIPIO",
      "UF",
    ],
  },
} as const satisfies Record<
  Exclude<UnimedDocumentKind, "NONE">,
  {
    fileName: string;
    sha256: string;
    downloadName: string;
    fields: readonly string[];
  }
>;

type GeneratedDocumentKind = keyof typeof TEMPLATE_DEFINITIONS;
const PRODUCTION_TEMPLATE_PATHS: Record<GeneratedDocumentKind, string> = {
  RN561: "/data/unimed-templates/MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
  INACTIVE_TERM: "/data/unimed-templates/MODELO_TERMO_INATIVO.docx",
};

type MergeValues = Record<string, string>;

type BeneficiaryDocumentData = {
  fullName: string;
  cpf: string | null;
  rg: string | null;
  category: "HOLDER" | "DEPENDENT";
  holder: { fullName: string; cpf: string | null } | null;
  dependents: Array<{ fullName: string; cpf: string | null }>;
  address: {
    addressLine: string | null;
    number: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
  } | null;
  branch: {
    name: string;
    companyName: string | null;
    cnpj: string;
    addressLine: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    stateRegistration: string | null;
    phone: string | null;
  } | null;
};

type FieldState = {
  instruction: string;
  fieldName: string | null;
  value: string;
  inResult: boolean;
  wroteResult: boolean;
};

export class UnimedDocumentError extends Error {
  constructor(
    readonly code:
      | "UNIMED_DOCUMENT_BENEFICIARY_NOT_FOUND"
      | "UNIMED_DOCUMENT_REASON_MISMATCH"
      | "UNIMED_DOCUMENT_CPF_REQUIRED"
      | "UNIMED_DOCUMENT_DEPENDENT_LIMIT"
      | "UNIMED_DOCUMENT_TEMPLATE_NOT_CONFIGURED"
      | "UNIMED_DOCUMENT_TEMPLATE_UNAVAILABLE"
      | "UNIMED_DOCUMENT_TEMPLATE_UNVERIFIED"
      | "UNIMED_DOCUMENT_TEMPLATE_INVALID",
    readonly status: 404 | 422 | 503,
  ) {
    super(code);
    this.name = "UnimedDocumentError";
  }
}

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

function formatCpf(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 11) return "";
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatCnpj(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 14) return value?.trim() ?? "";
  return digits.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5",
  );
}

function requireCpf(value: string | null) {
  const formatted = formatCpf(value);
  if (!formatted) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_CPF_REQUIRED", 422);
  }
  return formatted;
}

export function buildUnimedDocumentValues(
  beneficiary: BeneficiaryDocumentData,
  reasonCode: 1 | 2 | 8,
): { kind: GeneratedDocumentKind; values: MergeValues } {
  if (reasonCode === 1 && beneficiary.category !== "DEPENDENT") {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_REASON_MISMATCH", 422);
  }
  if (reasonCode !== 1 && beneficiary.category !== "HOLDER") {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_REASON_MISMATCH", 422);
  }

  if (reasonCode === 8) {
    return {
      kind: "INACTIVE_TERM",
      values: {
        TITULAR: beneficiary.fullName,
        CPF: requireCpf(beneficiary.cpf),
        RG: beneficiary.rg?.trim() ?? "",
        ENDEREÇO: beneficiary.address?.addressLine ?? "",
        Numero: beneficiary.address?.number ?? "",
        CEP: beneficiary.address?.postalCode ?? "",
        MUNICIPIO: beneficiary.address?.city ?? "",
        UF: beneficiary.address?.state ?? "",
      },
    };
  }

  const holder = reasonCode === 1 ? beneficiary.holder : beneficiary;
  if (!holder) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_REASON_MISMATCH", 422);
  }

  const dependents =
    reasonCode === 1
      ? [{ fullName: beneficiary.fullName, cpf: beneficiary.cpf }]
      : beneficiary.dependents;
  if (dependents.length > 6) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_DEPENDENT_LIMIT", 422);
  }

  const values: MergeValues = {
    Razão_social:
      beneficiary.branch?.companyName ?? beneficiary.branch?.name ?? "",
    ENDEREÇO: beneficiary.branch?.addressLine ?? "",
    Numero: beneficiary.branch?.number ?? "",
    Bairro: beneficiary.branch?.district ?? "",
    Cidade: beneficiary.branch?.city ?? "",
    UF: beneficiary.branch?.state ?? "",
    CNPJ: formatCnpj(beneficiary.branch?.cnpj ?? null),
    Inscrição_Estadual: beneficiary.branch?.stateRegistration ?? "",
    Telefone: beneficiary.branch?.phone ?? "",
    NOME: holder.fullName,
    CPF: requireCpf(holder.cpf),
  };

  for (let index = 0; index < 6; index += 1) {
    const dependent = dependents[index];
    values[`DEPENDENTE${index + 1}`] = dependent?.fullName ?? "";
    values[`CPF${index + 1}`] = dependent ? requireCpf(dependent.cpf) : "";
  }

  return { kind: "RN561", values };
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

async function loadVerifiedTemplate(kind: GeneratedDocumentKind) {
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

export async function generateUnimedDocument(
  tenantId: string,
  beneficiaryId: string,
  documentKindOrLegacyReason: GeneratedDocumentKind | 1 | 2 | 8,
) {
  const beneficiary = await prisma.unimedBeneficiary.findFirst({
    where: {
      id: beneficiaryId,
      tenantId,
      competency: { status: { in: ["ACTIVE", "PREVIOUS"] } },
    },
    select: {
      fullName: true,
      cpf: true,
      rg: true,
      category: true,
      holder: { select: { fullName: true, cpf: true } },
      dependents: {
        orderBy: { sourceKey: "asc" },
        select: { fullName: true, cpf: true },
      },
      address: {
        select: {
          addressLine: true,
          number: true,
          postalCode: true,
          city: true,
          state: true,
        },
      },
      branch: {
        select: {
          name: true,
          companyName: true,
          cnpj: true,
          addressLine: true,
          number: true,
          district: true,
          city: true,
          state: true,
          stateRegistration: true,
          phone: true,
        },
      },
    },
  });

  if (!beneficiary) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_BENEFICIARY_NOT_FOUND", 404);
  }

  const templateReasonCode: 1 | 2 | 8 =
    typeof documentKindOrLegacyReason === "number"
      ? documentKindOrLegacyReason
      : documentKindOrLegacyReason === "INACTIVE_TERM"
        ? 8
        : beneficiary.category === "DEPENDENT"
          ? 1
          : 2;
  const document = buildUnimedDocumentValues(beneficiary, templateReasonCode);
  const template = await loadVerifiedTemplate(document.kind);
  const bytes = await renderUnimedDocumentTemplate(
    template,
    document.kind,
    document.values,
  );

  return {
    bytes,
    contentType: DOCX_CONTENT_TYPE,
    fileName: TEMPLATE_DEFINITIONS[document.kind].downloadName,
    kind: document.kind,
  };
}
