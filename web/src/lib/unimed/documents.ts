import { prisma } from "@/lib/prisma";
import {
  DOCX_CONTENT_TYPE,
  TEMPLATE_DEFINITIONS,
  UnimedDocumentError,
  type GeneratedDocumentKind,
} from "./document-core";
import {
  loadVerifiedTemplate,
  renderUnimedDocumentTemplate,
} from "./document-template";
import { buildUnimedDocumentValues } from "./document-values";

export {
  UnimedDocumentError,
  buildUnimedDocumentValues,
  renderUnimedDocumentTemplate,
};

export async function generateUnimedDocument(
  tenantId: string,
  beneficiaryId: string,
  documentKindOrLegacyReason: GeneratedDocumentKind | 1 | 2 | 8,
  options?: { dependentIds?: string[]; reasonCode?: number },
) {
  const selectedDependentIds = options?.dependentIds;
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
        ...(selectedDependentIds
          ? { where: { id: { in: selectedDependentIds } } }
          : {}),
        orderBy: { sourceKey: "asc" },
        select: { id: true, fullName: true, cpf: true },
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
  if (
    selectedDependentIds &&
    beneficiary.dependents.length !== selectedDependentIds.length
  ) {
    throw new UnimedDocumentError("UNIMED_DOCUMENT_BENEFICIARY_NOT_FOUND", 404);
  }

  const templateReasonCode: 1 | 2 | 8 =
    options?.reasonCode === 1 ||
    options?.reasonCode === 2 ||
    options?.reasonCode === 8
      ? options.reasonCode
      : typeof documentKindOrLegacyReason === "number"
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
