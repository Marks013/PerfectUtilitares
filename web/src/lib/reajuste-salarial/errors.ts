import { MAX_DIAGNOSTICS } from "./limits";
import type { SalaryAdjustmentDiagnostic } from "./types";

export type SalaryAdjustmentErrorCode =
  | "REAJUSTE_COMPETENCY_INVALID"
  | "REAJUSTE_COMPETENCY_DUPLICATE"
  | "REAJUSTE_PERCENTAGE_INVALID"
  | "REAJUSTE_WORKBOOK_INVALID"
  | "REAJUSTE_STRUCTURE_INVALID"
  | "REAJUSTE_REGISTRATION_DUPLICATE"
  | "REAJUSTE_NAME_CONFLICT"
  | "REAJUSTE_RULE_INVALID"
  | "REAJUSTE_ROW_LIMIT_EXCEEDED";

export class SalaryAdjustmentError extends Error {
  constructor(
    public readonly code: SalaryAdjustmentErrorCode,
    message: string,
    public readonly diagnostics: SalaryAdjustmentDiagnostic[] = [],
    public readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "SalaryAdjustmentError";
    this.diagnostics = diagnostics.slice(0, MAX_DIAGNOSTICS);
  }
}
