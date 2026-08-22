import {
  validateXlsxArchive,
  XlsxSecurityError,
} from "@/lib/spreadsheets/xlsx-security";

export class UnimedXlsxSecurityError extends Error {
  readonly code = "UNIMED_XLSX_UNSAFE";

  constructor(reason: string) {
    super(
      `A planilha XLSX foi recusada por segurança: ${reason}. Exporte novamente como XLSX e tente outra vez; a base anterior foi preservada.`,
    );
    this.name = "UnimedXlsxSecurityError";
  }
}

export function validateUnimedXlsxArchive(bytes: Buffer) {
  try {
    return validateXlsxArchive(bytes);
  } catch (error) {
    if (error instanceof XlsxSecurityError) {
      throw new UnimedXlsxSecurityError(error.reason);
    }
    throw error;
  }
}
