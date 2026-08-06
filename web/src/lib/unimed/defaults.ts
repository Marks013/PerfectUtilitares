import type { UnimedDocumentKind } from "@/generated/prisma/client";

export const DEFAULT_UNIMED_EMAIL_SUBJECT = "Solicitação de Coparticipação";

export type DefaultUnimedExclusionReason = {
  code: number;
  label: string;
  documentKind: UnimedDocumentKind;
};

export const DEFAULT_UNIMED_EXCLUSION_REASONS = [
  { code: 1, label: "Exclusão de dependente", documentKind: "RN561" },
  { code: 2, label: "Exclusão de titular", documentKind: "RN561" },
  { code: 3, label: "Não informado", documentKind: "NONE" },
  { code: 4, label: "Acordo", documentKind: "NONE" },
  { code: 5, label: "Pedido IMED/TRAB", documentKind: "NONE" },
  { code: 6, label: "Fim antecipado", documentKind: "NONE" },
  { code: 7, label: "Fim de contrato", documentKind: "NONE" },
  { code: 8, label: "Dispensa S/J", documentKind: "INACTIVE_TERM" },
] as const satisfies readonly DefaultUnimedExclusionReason[];

export function documentKindForReason(reasonCode: number): UnimedDocumentKind {
  return (
    DEFAULT_UNIMED_EXCLUSION_REASONS.find(
      (reason) => reason.code === reasonCode,
    )?.documentKind ?? "NONE"
  );
}
