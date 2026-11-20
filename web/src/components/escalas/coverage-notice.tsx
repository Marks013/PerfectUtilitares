import type { EscalaValidation } from "@/lib/escalas/types";
import { buttonClass } from "./controls";
import styles from "./escalas.module.css";

/** Uses the existing validation result rather than recalculating coverage during rendering. */
export function EstimatedCoverageNotice({ validation, hasRoster, outdated = false, onReview }: {
  validation: EscalaValidation | null; hasRoster: boolean; outdated?: boolean; onReview: () => void;
}) {
  if (!hasRoster || outdated || !validation?.issues.some(issue => issue.code === "ESTIMATED_COVERAGE_GAP" || issue.code === "ESTIMATED_SECTOR_EMPTY")) return null;
  const empty = validation.issues.filter(issue => issue.code === "ESTIMATED_SECTOR_EMPTY").length;
  return <div className={styles.actions}>
    <p className={styles.muted}>Há desfalques estimados.{empty > 0 ? ` Atenção: ${empty} referência(s) com zero presença horária conhecida em faixa de funcionamento. Confira antes de publicar.` : ""}</p>
    <button type="button" className={buttonClass} onClick={onReview}>Ver setores e horários</button>
  </div>;
}
