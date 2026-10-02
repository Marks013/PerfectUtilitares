export const DEFAULT_PACKER_PERCENTAGE_TEN_THOUSANDTHS = 22_655n;

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[.]/g, "").replace(/\s+/g, " ").trim();
}

const BLOCKED_STATUSES = new Set(["LIC S/ REMUNERACAO", "LIC S/REMUNERACAO", "LICENCA SEM REMUNERACAO", "DEMITIDO", "APOSENT INVALIDEZ", "APOSENTADORIA POR INVALIDEZ", "DETENCAO"]);

export function payrollExclusionReason(status: string | null | undefined): string | null {
  return status && BLOCKED_STATUSES.has(normalized(status)) ? `Situação impeditiva: ${status.trim()}` : null;
}

export function isHandPacker(role: string | null | undefined): boolean {
  return Boolean(role && normalized(role.replace(/^\d+\s*-\s*/, "")) === "EMBALADOR A MAO");
}
