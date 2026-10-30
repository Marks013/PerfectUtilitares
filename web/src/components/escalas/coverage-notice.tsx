import type { EscalaValidation } from "@/lib/escalas/types";
import { buttonClass } from "./controls";
import styles from "./escalas.module.css";

/** Uses the existing validation result rather than recalculating coverage during rendering. */
export function EstimatedCoverageNotice({ validation, hasRoster, outdated = false, onReview }: {
  validation: EscalaValidation | null; hasRoster: boolean; outdated?: boolean; onReview: () => void;
}) {
  if (!hasRoster || outdated || !validation?.issues.some(issue => issue.code === "ESTIMATED_COVERAGE_GAP")) return null;
  return <div className={styles.actions}>
    <p className={styles.muted}>Há desfalques estimados.</p>
    <button type="button" className={buttonClass} onClick={onReview}>Ver setores e horários</button>
  </div>;
}
