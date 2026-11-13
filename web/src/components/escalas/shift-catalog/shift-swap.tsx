"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalaEmployee, EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoCatalogEntryDto, TurnoCatalogPageDto, TurnoSwapPreviewDto } from "@/lib/escalas/shift-catalog/contracts";
import { visibleDates } from "@/lib/escalas/dates";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "../controls";
import { clock, displayDate } from "../workspace-model";
import styles from "../escalas.module.css";
import { catalogError, catalogPost, catalogRequest } from "./client";

export function ShiftSwap({ workspace, employee, disabled, onApplied, onClose }: {
  workspace: EscalaWorkspace; employee: EscalaEmployee; disabled: boolean; onApplied: () => void; onClose: () => void;
}) {
  const dates = visibleDates(workspace.input);
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<TurnoCatalogEntryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [code, setCode] = useState<number | null>(null);
  const [from, setFrom] = useState(dates[0] ?? workspace.input.startDate);
  const [until, setUntil] = useState(dates.at(-1) ?? workspace.input.endDate);
  const [preview, setPreview] = useState<TurnoSwapPreviewDto | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const activeSearch = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    activeSearch.current?.abort();
    activeSearch.current = abort;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ search, limit: "30" });
    void catalogRequest<TurnoCatalogPageDto>("/api/escalas/turnos?" + query, { signal: abort.signal })
      .then(page => { if (activeSearch.current === abort && !abort.signal.aborted) { setEntries(page.entries); setCursor(page.nextCursor); } })
      .catch(cause => { if (activeSearch.current === abort && !abort.signal.aborted) setError(catalogError(cause)); })
      .finally(() => { if (activeSearch.current === abort && !abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [search]);
  const selected = entries.find(entry => entry.code === code);
  const original = employee.shiftIds.map(id => workspace.input.shifts.find(shift => shift.id === id)).filter(shift => shift !== undefined);
  function changeDate(set: (value: string) => void, value: string) { set(value); setPreview(null); }
  async function more() {
    if (!cursor || loading || running.current) return;
    const request = activeSearch.current;
    if (!request || request.signal.aborted) return;
    running.current = true; setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ search, cursor, limit: "30" });
      const page = await catalogRequest<TurnoCatalogPageDto>("/api/escalas/turnos?" + query, { signal: request.signal });
      if (request !== activeSearch.current || request.signal.aborted) return;
      setEntries(previous => [...previous, ...page.entries.filter(entry => !previous.some(item => item.code === entry.code))]);
      setCursor(page.nextCursor);
    } catch (cause) { if (request === activeSearch.current && !request.signal.aborted) setError(catalogError(cause)); }
    finally { running.current = false; if (request === activeSearch.current && !request.signal.aborted) setLoading(false); }
  }
  async function requestPreview() {
    if (disabled || busy || code === null || !from || !until || from > until || running.current) return;
    running.current = true; setBusy(true); setError(""); setPreview(null);
    try {
      setPreview(await catalogPost<TurnoSwapPreviewDto>("/api/escalas/turnos", {
        action: "PREVIEW_SWAP", workspaceId: workspace.id, expectedRevision: workspace.revision,
        employeeId: employee.id, catalogCode: code, effectiveFrom: from, effectiveUntil: until,
      }));
    } catch (cause) { setError(catalogError(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  async function apply() {
    if (disabled || busy || !preview?.canApply || code === null || running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      await catalogPost<unknown>("/api/escalas/turnos", {
        action: "APPLY_SWAP", workspaceId: workspace.id, expectedRevision: workspace.revision,
        employeeId: employee.id, catalogCode: code, effectiveFrom: from, effectiveUntil: until,
        previewId: preview.previewId, confirm: true,
      });
      onApplied();
    } catch (cause) { setError(catalogError(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  return <section className={panelClass} aria-label={"Trocar turno de " + employee.name}>
    <div className={styles.header}><h3 className={styles.sectionTitle}>Trocar turno · {employee.name}</h3><button type="button" className={buttonClass} disabled={busy} onClick={onClose}>Fechar</button></div>
    <p className={styles.muted}>Horário atual: {original.length ? original.map(shift => shift.segments.map(segment => clock(segment.start) + "–" + clock(segment.end)).join(" / ")).join("; ") : "sem referência de horário"}. Nenhuma alteração é aplicada antes da confirmação.</p>
    <Field label="Buscar no catálogo da empresa">{id => <input id={id} type="search" className={controlClass} value={search} disabled={busy} onChange={event => { activeSearch.current?.abort(); setSearch(event.target.value); setCode(null); setPreview(null); }} />}</Field>
    <div className="max-h-48 overflow-auto"><ul>{entries.map(entry => <li key={entry.code}><label className={styles.check}><input type="radio" name={"catalog-" + employee.id} checked={code === entry.code} disabled={disabled || busy} onChange={() => { setCode(entry.code); setPreview(null); }} /><span>{entry.code} · {entry.name} · {entry.markings.join(" / ")}</span></label></li>)}</ul></div>
    {loading && <p role="status">Consultando turnos…</p>}
    {cursor && <button type="button" className={buttonClass} disabled={loading || busy} onClick={() => void more()}>Carregar mais turnos</button>}
    {!loading && entries.length === 0 && <p className={styles.muted}>Nenhum turno encontrado. Ajuste a busca ou cadastre as referências na exportação.</p>}
    <div className={styles.formGrid}><Field label="Vigência inicial">{id => <input id={id} type="date" className={controlClass} value={from} disabled={disabled || busy} onChange={event => changeDate(setFrom, event.target.value)} />}</Field><Field label="Vigência final">{id => <input id={id} type="date" className={controlClass} value={until} disabled={disabled || busy} onChange={event => changeDate(setUntil, event.target.value)} />}</Field></div>
    <button type="button" className={buttonClass} disabled={disabled || busy || code === null || !from || !until || from > until} onClick={() => void requestPreview()}>Conferir troca</button>
    {selected && <p className={styles.muted}>Turno proposto: {selected.code} · {selected.name} · {selected.markings.join(" / ")}</p>}
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {preview && <div className={styles.stackSmall}>
      <p>{preview.validationLevel === "NO_SCHEDULE" ? "Sem grade: a troca altera a referência, sem criar dias de trabalho ou folga." : "Confira a revisão antes de aplicar."}</p>
      <p>{preview.affected.length} dia(s) afetado(s) · {preview.preserved.length} dia(s) preservado(s).</p>
      {preview.affected.length > 0 && <details><summary>Consultar dias afetados</summary><ul>{preview.affected.map(day => <li key={day.date}>{displayDate(day.date)} · {day.previousCatalogCode ?? "referência local"} → {day.nextCatalogCode}</li>)}</ul></details>}
      {preview.preserved.length > 0 && <details><summary>Consultar dias preservados</summary><ul>{preview.preserved.map(day => <li key={day.date}>{displayDate(day.date)} · {({ LOCKED: "bloqueado", MANUAL: "ajuste manual", ABSENCE: "afastamento", OFF: "folga", HOLIDAY: "feriado", NO_SHIFT: "sem turno" } as const)[day.reason]}</li>)}</ul></details>}
      {preview.validationIssues.length > 0 && <ul>{preview.validationIssues.map(issue => <li key={JSON.stringify(issue)}>{issue.message}</li>)}</ul>}
      <button type="button" className={primaryClass} disabled={disabled || busy || !preview.canApply} onClick={() => void apply()}>{busy ? "Aplicando…" : "Confirmar troca de turno"}</button>
    </div>}
    {disabled && <p className={styles.muted}>Salve as alterações e conclua o processamento antes de trocar o turno.</p>}
  </section>;
}
