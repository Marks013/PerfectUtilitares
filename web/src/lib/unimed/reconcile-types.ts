import type {
  ParsedBeneficiary,
  ParsedInvoiceItem,
} from "@/lib/unimed/importer";

export type AddressFields = ParsedBeneficiary["address"];

type ReconciledBeneficiary = ParsedBeneficiary & {
  holderSourceKey: string | null;
  hasAddon: boolean;
  planCode: string | null;
  address: AddressFields;
};

type ReconciledInvoiceItem = ParsedInvoiceItem & {
  beneficiarySourceKey: string | null;
};

export type PreviousUnimedDependentLink = {
  dependent: {
    branchCode: string;
    registration: string | null;
    cpf: string | null;
    fullName: string;
  };
  holder: {
    branchCode: string;
    registration: string | null;
    cpf: string | null;
    fullName: string;
  };
};

export type UnimedReconciliation = {
  beneficiaries: ReconciledBeneficiary[];
  invoiceItems: ReconciledInvoiceItem[];
  branches: Array<{ code: string; cnpj: string }>;
  warnings: {
    unmatchedInvoiceItems: number;
    unmatchedDependents: number;
    ambiguousPlanCodes: number;
  };
  warningDetails: {
    unmatchedInvoiceItems: Array<{
      sourceKey: string;
      branchCode: string;
      beneficiaryName: string;
      category: ParsedInvoiceItem["category"];
      itemDescription: string;
      reason:
        | "CPF_NOT_FOUND"
        | "CPF_AMBIGUOUS"
        | "REGISTRATION_NOT_FOUND"
        | "REGISTRATION_AMBIGUOUS"
        | "SAFE_IDENTIFIER_MISSING";
    }>;
    unmatchedDependents: Array<{
      sourceKey: string;
      branchCode: string;
      fullName: string;
      reason:
        | "INVOICE_REFERENCE_MISSING"
        | "HOLDER_NAME_MISSING"
        | "HOLDER_NOT_UNIQUE";
    }>;
    ambiguousPlanCodes: Array<{
      sourceKey: string;
      branchCode: string;
      fullName: string;
      planCodes: string[];
    }>;
  };
  information: {
    addressOnlyRows: number;
    dependentsLinkedByRegistration: number;
    dependentsLinkedFromPreviousCompetency: number;
  };
};

