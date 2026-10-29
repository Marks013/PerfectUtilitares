"use client";

import { useEffect, useId, useRef, useState } from "react";
import { mergeAbsenceAssignments } from "@/lib/escalas/absence-merge";
import type { AbsenceImportPreview } from "@/lib/escalas/fphi105";
import type { EscalaAssignment, EscalaInput } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";
import { ProcessingBar } from "./workspace-feedback";
import { displayDate, errorMessage, responseMessage } from "./workspace-model";

/** Only context that determines the interpretation of this file belongs in the preview identity. */
export function absenceScenarioKey(input: EscalaInput) {
  return JSON.stringify([input.branchCode, input.startDate, input.endDate, input.visibleMonth, input.defaultWeeklyHours,
    input.employees.map((person) => [person.id, person.registration, person.activeFrom, person.activeUntil, person.planningEnabled])]);
}

export function absencePeriods(assignments: EscalaAssignment[]) {
  const sorted = [...assignments].filter((item) => item.kind === "ABSENCE").sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  const periods: { employeeId: string; startDate: string; endDate: string }[] = [];
  for (const item of sorted) {
    const previous = periods.at(-1);
    if (previous?.employeeId === item.employeeId && item.date === previous.endDate) continue;
    if (previous?.employeeId === item.employeeId && Date.parse(item.date) - Date.parse(previous.endDate) === 86_400_000) previous.endDate = item.date;
    else periods.push({ employeeId: item.employeeId, startDate: item.date, endDate: item.date });
  }
  return periods;
}

export function AbsenceImportReview({ preview, input, disabled, onApply }: {
  preview: AbsenceImportPreview; input: EscalaInput; disabled: boolean; onApply: () => void;
}) {
  const [limit, setLimit] = useState(20);
  const periods = absencePeriods(preview.assignments);
  const people = new Map(input.employees.map((person) => [person.id, person]));
  const conflicts = mergeAbsenceAssignments(input.assignments, preview.assignments).conflicts;
  return <div className={styles.stackSmall}>
    <p className={styles.feedbackHeader}>Prévia: {preview.counts.employees} colaboradores · {preview.counts.days} dias de afastamento</p>
    {preview.reportPeriod && <p className={styles.muted}>Período do relatório: {displayDate(preview.reportPeriod.startDate)} a {displayDate(preview.reportPeriod.endDate)}.</p>}
    <p className={styles.muted}>{preview.counts.matchedRows} registros correspondentes à equipe. {preview.counts.unmatchedRows} sem matrícula nesta filial; {preview.counts.outsidePeriodRows} fora do período. Nada foi alterado ainda.</p>
    {preview.issues.length > 0 && <details className={styles.disclosure}>
      <summary className={styles.disclosureTrigger}>Conferir avisos do arquivo ({preview.issues.length})</summary>
      <ul className={styles.editorIssues}>{preview.issues.map((issue) => <li key={`${issue.line}:${issue.code}:${issue.message}`}>{issue.line > 0 ? `Linha ${issue.line}: ` : ""}{issue.message}</li>)}</ul>
    </details>}
    {conflicts.length > 0 && <p role="status" className={styles.errorText}>{conflicts.length} dias bloqueados serão preservados. Para incluir esses dias, confira os bloqueios na escala e importe novamente.</p>}
    <ul className={styles.stackSmall} aria-label="Períodos de afastamento encontrados">
      {periods.slice(0, limit).map((period) => {
        const person = people.get(period.employeeId);
        return <li key={`${period.employeeId}:${period.startDate}`} className={styles.muted}>
          <strong>{person?.name ?? "Colaborador da equipe"} · matrícula {person?.registration ?? "não localizada"}</strong><br />
          {displayDate(period.startDate)} a {displayDate(period.endDate)} · afastamento
        </li>;
      })}
    </ul>
    {periods.length > limit && <button type="button" className={buttonClass} onClick={() => setLimit((value) => value + 20)}>Mostrar mais períodos</button>}
    {!preview.assignments.length && <p className={styles.muted}>Nenhum afastamento aplicável. Confira se a equipe e o mês correspondem ao relatório.</p>}
    <div className={styles.actions}><button type="button" className={primaryClass} disabled={disabled || !preview.assignments.length} onClick={onApply}>Aplicar afastamentos à proposta</button></div>
    <p className={styles.muted}>A aplicação preserva afastamentos existentes e dias bloqueados. Depois, gere a proposta e salve a revisão.</p>
  </div>;
}

export function AbsenceImport({ input, disabled, onChange }: {
  input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ data: AbsenceImportPreview; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Pronto. Se houver afastamentos ou férias, selecione o FPHI105. A importação é opcional.");
  const hintId = useId();
  const key = absenceScenarioKey(input);
  const current = useRef({ input, disabled, key });
  current.current = { input, disabled, key };
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const processing = useRef(false);
  const previousKey = useRef(key);
  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    request.current += 1;
    controller.current?.abort();
    processing.current = false;
    setBusy(false);
    setPreview(null);
    setError("");
    setStatus("Planejamento alterado. Confira o arquivo novamente antes de aplicar os afastamentos.");
  }, [key]);
  useEffect(() => {
    if (!disabled || !processing.current) return;
    request.current += 1;
    controller.current?.abort();
    processing.current = false;
    setBusy(false);
    setStatus("Conferência interrompida durante outra operação. Confira o arquivo novamente quando terminar.");
  }, [disabled]);
  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);
  async function analyze() {
    if (!file || processing.current || current.current.disabled) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size < 1 || file.size > 512 * 1024) {
      setError("Selecione um CSV FPHI105 de até 512 KB e confira novamente.");
      return;
    }
    const id = ++request.current;
    const snapshot = current.current;
    const operationController = new AbortController();
    controller.current = operationController;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; operationController.abort(); }, 30_000);
    processing.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    setStatus("Processando. Conferindo matrículas e períodos de afastamento…");
    const active = () => id === request.current && snapshot.key === current.current.key && !current.current.disabled;
    try {
      const form = new FormData();
      form.set("purpose", "ABSENCES");
      form.set("file", file);
      form.set("branchCode", snapshot.input.branchCode);
      form.set("startDate", snapshot.input.startDate);
      form.set("endDate", snapshot.input.endDate);
      if (snapshot.input.visibleMonth) form.set("visibleMonth", snapshot.input.visibleMonth);
      form.set("employees", JSON.stringify(snapshot.input.employees.map(({ id: employeeId, registration }) => ({ id: employeeId, registration }))));
      const response = await fetch("/api/escalas/import", { method: "POST", body: form, signal: operationController.signal });
      const body = await response.json().catch(() => { throw new Error("O servidor não conseguiu responder à conferência."); });
      if (!active()) return;
      if (!response.ok) throw new Error(responseMessage(body));
      const data: AbsenceImportPreview = body.preview;
      setPreview({ data, key: snapshot.key });
      setStatus(data.issues.length ? "Concluído com avisos. Confira a prévia antes de aplicar." : "Concluído. Confira os períodos antes de aplicar.");
    } catch (cause) {
      if (!active()) return;
      const message = timedOut ? "A conferência demorou mais que o esperado." : cause instanceof TypeError ? "Não foi possível conectar ao servidor." : errorMessage(cause);
      setError(`${message} Confira o arquivo e use Conferir afastamentos para tentar novamente.`);
      setStatus("Falha. Nenhum afastamento foi aplicado.");
    } finally {
      clearTimeout(timeout);
      if (id === request.current) { processing.current = false; setBusy(false); }
    }
  }
  function applyPreview() {
    if (!preview || preview.key !== current.current.key || current.current.disabled || processing.current) return;
    const latest = current.current.input;
    const merged = mergeAbsenceAssignments(latest.assignments, preview.data.assignments);
    const existing = new Set(latest.assignments.filter((item) => item.kind === "ABSENCE").map((item) => `${item.employeeId}:${item.date}`));
    const added = merged.assignments.filter((item) => item.kind === "ABSENCE" && !existing.has(`${item.employeeId}:${item.date}`)).length;
    if (added > 0) onChange({ ...latest, assignments: merged.assignments });
    setPreview(null);
    setStatus(`${(merged.conflicts.length ? "Concluído com avisos. " : "Concluído. ") + added} dias de afastamento aplicados à proposta. ${merged.conflicts.length ? `${merged.conflicts.length} dias bloqueados foram preservados; confira os bloqueios na escala. ` : ""}${added ? "Gere novamente e salve a revisão." : "Nenhum registro novo; os afastamentos existentes foram preservados."}`);
  }
  if (!input.employees.length) return null;
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Importar afastamentos e férias (opcional)</summary>
    <p id={hintId} className={styles.muted}>Use o CSV FPHI105 para considerar férias e outros afastamentos. A correspondência usa a matrícula da equipe atual. Dados médicos não são importados.</p>
    <Field label="Arquivo de afastamentos CSV">{(id) => <input id={id} aria-describedby={hintId} className={controlClass} type="file" accept=".csv" disabled={disabled || busy} onChange={(event) => {
      request.current += 1;
      controller.current?.abort();
      processing.current = false;
      setBusy(false);
      setFile(event.target.files?.[0] ?? null);
      setPreview(null);
      setError("");
      setStatus(event.target.files?.[0] ? "Pronto. Clique em Conferir afastamentos." : "Pronto. A importação de afastamentos é opcional.");
    }} />}</Field>
    <div className={styles.actions}><button type="button" className={buttonClass} disabled={disabled || busy || !file} onClick={() => void analyze()}>{busy ? "Conferindo afastamentos…" : "Conferir afastamentos"}</button></div>
    <p role="status" aria-live="polite" aria-atomic="true" className={styles.muted}>{status}</p>
    {busy && <ProcessingBar label="Conferindo afastamentos" />}
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {preview && preview.key === key && <AbsenceImportReview preview={preview.data} input={input} disabled={disabled || busy} onApply={applyPreview} />}
  </details>;
}
