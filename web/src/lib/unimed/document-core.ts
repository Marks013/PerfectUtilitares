import type { UnimedDocumentKind } from "@/generated/prisma/client";

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export const MAX_XML_BYTES = 2 * 1024 * 1024;

export const TEMPLATE_DEFINITIONS = {
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

export type GeneratedDocumentKind = keyof typeof TEMPLATE_DEFINITIONS;
export type MergeValues = Record<string, string>;

export type BeneficiaryDocumentData = {
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

