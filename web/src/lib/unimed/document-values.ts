import {
  UnimedDocumentError,
  type BeneficiaryDocumentData,
  type GeneratedDocumentKind,
  type MergeValues,
} from "./document-core";

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
  if (
    reasonCode === 1 &&
    beneficiary.category !== "DEPENDENT" &&
    (beneficiary.category !== "HOLDER" || beneficiary.dependents.length === 0)
  ) {
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

  const holder =
    reasonCode === 1 && beneficiary.category === "DEPENDENT"
      ? beneficiary.holder
      : beneficiary;
  if (!holder) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_REASON_MISMATCH", 422);
  }

  const dependents =
    reasonCode === 1 && beneficiary.category === "DEPENDENT"
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
