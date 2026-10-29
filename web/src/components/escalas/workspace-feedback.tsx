"use client";

import { buttonClass } from "./controls";
import type { EscalaProblem, EscalaRecoveryAction } from "./workspace-feedback-model";
import styles from "./escalas.module.css";

/** Indeterminate by design: the processor does not publish a reliable percentage. */
export function ProcessingBar({ label }: { label: string }) {
  return <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-busy="true"><span className={styles.progressFill} aria-hidden="true" /></div>;
}

export function WorkspaceFeedback({ busy, notice, error, problem, onAction }: {
  busy: string; notice: string; error: string; problem?: EscalaProblem | null; onAction?: (action: EscalaRecoveryAction) => void;
}) {
  if (busy) return <section className={styles.feedback} aria-busy="true" role="status" aria-live="polite" aria-atomic="true"><p className={styles.feedbackHeader}>{busy}</p><ProcessingBar label={busy} /></section>;
  const message = error || problem?.message || notice;
  if (!message) return null;
  const failed = Boolean(error) || problem?.tone === "error";
  const tone = failed ? "error" : problem?.tone ?? "success";
  return <section className={[styles.feedback, failed ? styles.feedbackError : tone === "success" ? styles.feedbackSuccess : ""].filter(Boolean).join(" ")} data-tone={tone} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} aria-atomic="true">
    <p className={styles.feedbackHeader}>{message}</p>
    {problem?.explanation && <p className={styles.feedbackText}>{problem.explanation}</p>}
    {problem?.action && <div className={styles.feedbackActions}>
      {problem.action === "login" ? <a className={buttonClass} href="/login?callbackUrl=%2Fescalas" target="_blank" rel="noopener noreferrer">{problem.actionLabel ?? "Entrar novamente"}</a>
        : onAction && <button type="button" className={buttonClass} onClick={() => { if (problem.action) onAction(problem.action); }}>{problem.actionLabel ?? "Conferir dados"}</button>}
    </div>}
  </section>;
}
