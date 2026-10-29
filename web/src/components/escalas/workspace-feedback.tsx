"use client";

import { buttonClass } from "./controls";
import { recoveryActionLabel, type EscalaProblem, type EscalaRecoveryAction } from "./workspace-feedback-model";
import type { EscalaRecoveryContext } from "./recovery-navigation";
import styles from "./escalas.module.css";

/** Indeterminate by design: the processor does not publish a reliable percentage. */
export function ProcessingBar({ label }: { label: string }) {
  return <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-busy="true"><span className={styles.progressFill} aria-hidden="true" /></div>;
}

export function WorkspaceFeedback({ busy, notice, error, problem, onAction }: {
  busy: string; notice: string; error: string; problem?: EscalaProblem | null; onAction?: (action: EscalaRecoveryAction, context?: EscalaRecoveryContext) => void;
}) {
  if (busy) return <section className={styles.feedback} aria-busy="true" role="status" aria-live="polite" aria-atomic="true"><p className={styles.feedbackHeader}>{busy}</p><ProcessingBar label={busy} /></section>;
  const message = error || problem?.message || notice;
  if (!message) return null;
  const failed = Boolean(error) || problem?.tone === "error";
  const tone = failed ? "error" : problem?.tone ?? "success";
  return <section className={[styles.feedback, failed ? styles.feedbackError : tone === "success" ? styles.feedbackSuccess : ""].filter(Boolean).join(" ")} data-tone={tone} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} aria-atomic="true">
    <p className={styles.feedbackHeader}>{message}</p>
    {problem?.explanation && <p className={styles.feedbackText}>{problem.explanation}</p>}
    {problem?.conflicts?.length ? <ol className="mt-3 space-y-3" aria-label="Condições que impedem a proposta">{problem.conflicts.map((conflict, index) => <li key={JSON.stringify([conflict.code, conflict.employeeId, conflict.date, conflict.sector, conflict.role, index])} className="border-t border-[color:var(--app-border)] pt-3">
      <p className={styles.feedbackText}>{conflict.message}</p>
      {onAction && <button type="button" className={buttonClass} onClick={() => onAction(conflict.target, { employeeId: conflict.employeeId, date: conflict.date, sector: conflict.sector, role: conflict.role })}>{recoveryActionLabel(conflict.target)}</button>}
    </li>)}</ol> : null}
    {problem?.action && !problem.conflicts?.length && <div className={styles.feedbackActions}>
      {onAction && <button type="button" className={buttonClass} onClick={() => { if (problem.action) onAction(problem.action); }}>{problem.actionLabel ?? "Conferir dados"}</button>}
    </div>}
  </section>;
}
