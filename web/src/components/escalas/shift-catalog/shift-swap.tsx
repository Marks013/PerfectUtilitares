"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EscalaEmployee, EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoCatalogEntryDto, TurnoSwapPreviewDto } from "@/lib/escalas/shift-catalog/contracts";
import type { TurnoCatalogOptionsDto } from "@/lib/escalas/shift-catalog/flow-contracts";
import { turnoCatalogOptionsSchema } from "@/lib/escalas/shift-catalog/flow-contracts";
import { visibleDates } from "@/lib/escalas/dates";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "../controls";
import { clock, displayDate } from "../workspace-model";
import { canDisplayEscalaAction, useEscalaClientAccess } from "../access-context";
import styles from "../escalas.module.css";
import local from "./flow.module.css";
import { catalogPost, catalogRequest } from "./client";
import { CatalogScope, useCatalogTask } from "./use-catalog-task";
import { validCatalogEntry } from "./flow-model";

type Props = { workspace: EscalaWorkspace; employee: EscalaEmployee; disabled: boolean; onApplied: () => void; onClose: () => void };
export function ShiftSwap(props: Props) {
  const access = useEscalaClientAccess();
  return <CatalogScope allowed={canDisplayEscalaAction(access, "shift.manage", props.workspace.input.branchCode)}><SwapSession key={`${props.workspace.id}:${props.workspace.revision}:${props.employee.id}`} {...props} /></CatalogScope>;
}

function SwapSession({ workspace, employee, disabled, onApplied, onClose }: Props) {
  const dates = visibleDates(workspace.input).filter(date => (!employee.activeFrom || date >= employee.activeFrom) && (!employee.activeUntil || date <= employee.activeUntil));
  const [search, setSearch] = useState(""), [from, setFrom] = useState(dates[0] ?? ""), [until, setUntil] = useState(dates.at(-1) ?? ""), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<{ key: string; entries: TurnoCatalogEntryDto[]; cursor: string | null } | null>(null);
  const [code, setCode] = useState<number | null>(null), [preview, setPreview] = useState<{ key: string; value: TurnoSwapPreviewDto } | null>(null);
  const task = useCatalogTask();
  const fromRef = useRef<HTMLInputElement>(null), untilRef = useRef<HTMLInputElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const optionsValidation = turnoCatalogOptionsSchema.safeParse({ workspaceId: workspace.id, expectedRevision: workspace.revision, employeeId: employee.id, effectiveFrom: from, effectiveUntil: until, search, cursor: "0", limit: 30 });
  const fieldErrors: Partial<Record<"effectiveFrom" | "effectiveUntil" | "search", string>> = {};
  if (!optionsValidation.success) for (const issue of optionsValidation.error.issues) {
    if (issue.path[0] === "effectiveFrom") fieldErrors.effectiveFrom = "Informe uma data inicial válida.";
    else if (issue.path[0] === "effectiveUntil") fieldErrors.effectiveUntil = "Informe uma data final válida.";
    else if (issue.path[0] === "search") fieldErrors.search = "Use até 48 caracteres na busca.";
    else if (!issue.path.length) fieldErrors.effectiveUntil ??= "A data final deve ser igual ou posterior à inicial.";
  }
  if (from && (from < workspace.input.startDate || from > workspace.input.endDate)) fieldErrors.effectiveFrom = "Escolha uma data inicial dentro do período do planejamento.";
  if (until && (until < workspace.input.startDate || until > workspace.input.endDate)) fieldErrors.effectiveUntil = "Escolha uma data final dentro do período do planejamento.";
  function validateFields() {
    const target = fieldErrors.effectiveFrom ? fromRef.current : fieldErrors.effectiveUntil ? untilRef.current : fieldErrors.search ? searchRef.current : null;
    if (target) { target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); return false; }
    return optionsValidation.success;
  }
  const invalidateTask = task.invalidate, runTask = task.run;
  const queryKey = JSON.stringify([workspace.id, workspace.revision, employee.id, from, until, search, retry]);
  const entries = page?.key === queryKey ? page.entries : [], cursor = page?.key === queryKey ? page.cursor : null;
  const chosen = entries.find(entry => entry.code === code), currentPreview = preview?.key === `${queryKey}:${code}` ? preview.value : null;
  const enabled = !disabled && workspace.canEdit && workspace.status === "DRAFT" && employee.planningEnabled !== false && employee.scheduleMode !== "MISSING" && employee.scheduleMode !== "UNTIMED" && Boolean(employee.shiftIds.length && dates.length);
  const requestOptions = useCallback(async (currentCursor: string, signal: AbortSignal) => {
      const request = turnoCatalogOptionsSchema.safeParse({ workspaceId: workspace.id, expectedRevision: workspace.revision, employeeId: employee.id, effectiveFrom: from, effectiveUntil: until, search, cursor: currentCursor, limit: 30 });
      if (!request.success) throw new Error("Confira as datas e a busca antes de consultar turnos permitidos.");
      const query = new URLSearchParams(Object.entries(request.data).map(([key, value]) => [key, String(value)]));
      const result = await catalogRequest<TurnoCatalogOptionsDto>("/api/escalas/turnos/opcoes?" + query, { signal });
      const ctx = result.context;
      if (!ctx || ctx.workspaceId !== workspace.id || ctx.revision !== workspace.revision || ctx.employeeId !== employee.id || ctx.effectiveFrom !== from || ctx.effectiveUntil !== until || !Array.isArray(result.entries)
        || result.entries.some(entry => !validCatalogEntry(entry) || entry.code <= request.data.cursor) || new Set(result.entries.map(entry => entry.code)).size !== result.entries.length
        || result.nextCursor !== null && (!/^\d+$/.test(result.nextCursor) || Number(result.nextCursor) <= request.data.cursor)) throw new Error("A lista não corresponde à pessoa, ao período ou à revisão atual. Consulte novamente.");
      return result;
  }, [workspace.id, workspace.revision, employee.id, from, until, search]);
  async function loadMore() {
    if (!enabled || !cursor) return;
    await runTask("Consultando turnos permitidos…", signal => requestOptions(cursor, signal), result => {
      if (result.entries.some(entry => entries.some(known => known.code === entry.code))) throw new Error("A lista mudou durante a paginação. Consulte novamente.");
      setPage({ key: queryKey, entries: [...entries, ...result.entries], cursor: result.nextCursor });
    });
  }
  useEffect(() => {
    invalidateTask(); setCode(null); setPreview(null); setPage(null);
    if (enabled) void runTask("Consultando turnos permitidos…", signal => requestOptions("0", signal), result => setPage({ key: queryKey, entries: result.entries, cursor: result.nextCursor }));
    return invalidateTask;
  }, [queryKey, enabled, invalidateTask, runTask, requestOptions]);
  function invalidateChoice() { task.invalidate(); setCode(null); setPreview(null); }
  async function requestPreview() {
    if (!enabled || !validateFields() || !chosen) return;
    setPreview(null);
    await task.run("Conferindo efeito da atribuição…", async signal => {
      const result = await catalogPost<TurnoSwapPreviewDto>("/api/escalas/turnos", { action: "PREVIEW_SWAP", workspaceId: workspace.id, expectedRevision: workspace.revision, employeeId: employee.id, catalogCode: chosen.code, effectiveFrom: from, effectiveUntil: until }, signal);
      if (!/^[a-f0-9]{64}$/.test(result.previewId) || result.workspaceId !== workspace.id || result.expectedRevision !== workspace.revision || result.employeeId !== employee.id || result.target?.code !== chosen.code || JSON.stringify(result.target.markings) !== JSON.stringify(chosen.markings)
        || !Array.isArray(result.affected) || !Array.isArray(result.preserved) || !Array.isArray(result.validationIssues) || typeof result.canApply !== "boolean" || !["FULL_SCHEDULE", "NO_SCHEDULE"].includes(result.validationLevel)) throw new Error("A prévia não corresponde à atribuição escolhida. Confira novamente.");
      return result;
    }, value => { setPreview({ key: `${queryKey}:${code}`, value }); if (!value.canApply) task.reportError(value.validationIssues.map(issue => issue.message).join(" ") || "A atribuição possui impedimentos. Confira os dias e as referências antes de continuar.", true); }, { focusOnError: true });
  }
  async function apply() {
    if (!enabled || !validateFields() || !currentPreview?.canApply || !chosen) return;
    await task.run("Salvando atribuição…", async signal => {
      const result = await catalogPost<EscalaWorkspace>("/api/escalas/turnos", { action: "APPLY_SWAP", workspaceId: workspace.id, expectedRevision: workspace.revision, employeeId: employee.id, catalogCode: chosen.code, effectiveFrom: from, effectiveUntil: until, previewId: currentPreview.previewId, confirm: true }, signal);
      if (result.id !== workspace.id || result.revision !== workspace.revision + 1 || result.input?.branchCode !== workspace.input.branchCode) throw new Error("A gravação não foi confirmada. Atualize o planejamento antes de repetir.");
      return result;
    }, () => { setPreview(null); onApplied(); }, { focusOnError: true });
  }
  const original = employee.shiftIds.flatMap(id => { const shift = workspace.input.shifts.find(item => item.id === id); return shift ? [shift.segments.map(segment => `${clock(segment.start)}–${clock(segment.end)}${segment.kind === "BREAK" ? " (intervalo)" : segment.kind === "PAID_BREAK" ? " (pausa remunerada)" : ""}`).join(" / ")] : []; });
  return <section className={panelClass} aria-label={`Atribuir turno cadastrado a ${employee.name}`}>
    <div className={styles.header}><h3 className={styles.sectionTitle}>Atribuir turno cadastrado · {employee.name}</h3><button type="button" className={buttonClass} disabled={Boolean(task.busy)} onClick={onClose}>Fechar</button></div>
    {task.error && <div ref={task.errorRef} role="alert" tabIndex={-1} aria-label="Problemas na atribuição de turno" className={`${styles.errorText} ${styles.feedbackFocus}`}><p><strong>Confira a atribuição de turno</strong></p><p>{task.error}</p></div>}
    <p className={styles.muted}>Filial {workspace.input.branchCode} · matrícula {employee.registration || "não informada"} · revisão {workspace.revision}. Horário atual: {original.join("; ") || "sem referência"}.</p>
    <p className={local.scopeNote}>Somente definições existentes permitidas pela configuração desta pessoa. A conferência ainda valida a grade. Não altera a jornada nem a configuração administrativa de 8h/9h.</p>
    <div className={styles.formGrid}>
      <Field label="Aplicar a partir de">{id => <><input id={id} ref={fromRef} type="date" min={workspace.input.startDate} max={workspace.input.endDate} className={controlClass} value={from} disabled={!enabled} aria-invalid={Boolean(fieldErrors.effectiveFrom)} aria-describedby={fieldErrors.effectiveFrom ? `${id}-error` : undefined} onChange={event => { invalidateChoice(); setFrom(event.target.value); }} />{fieldErrors.effectiveFrom && <span id={`${id}-error`} className={styles.errorText}>{fieldErrors.effectiveFrom}</span>}</>}</Field>
      <Field label="Aplicar até">{id => <><input id={id} ref={untilRef} type="date" min={workspace.input.startDate} max={workspace.input.endDate} className={controlClass} value={until} disabled={!enabled} aria-invalid={Boolean(fieldErrors.effectiveUntil)} aria-describedby={fieldErrors.effectiveUntil ? `${id}-error` : undefined} onChange={event => { invalidateChoice(); setUntil(event.target.value); }} />{fieldErrors.effectiveUntil && <span id={`${id}-error`} className={styles.errorText}>{fieldErrors.effectiveUntil}</span>}</>}</Field>
      <Field label="Buscar turno permitido pelo código ou pelas horas">{id => <><input id={id} ref={searchRef} type="search" maxLength={48} className={controlClass} value={search} disabled={!enabled} aria-invalid={Boolean(fieldErrors.search)} aria-describedby={fieldErrors.search ? `${id}-error` : undefined} onChange={event => { invalidateChoice(); setSearch(event.target.value); }} />{fieldErrors.search && <span id={`${id}-error`} className={styles.errorText}>{fieldErrors.search}</span>}</>}</Field>
    </div>
    <ul className={local.rows}>{entries.map(entry => <li key={entry.code}><label className={styles.check}><input type="radio" className={styles.checkInput} name={`permitted-${employee.id}`} disabled={!enabled || Boolean(task.busy)} checked={code === entry.code} onChange={() => { setCode(entry.code); setPreview(null); }} /><span>{entry.code} · {entry.markings.join(" / ")}</span></label></li>)}</ul>
    {page?.key === queryKey && !entries.length && !task.busy && !task.error && <p>Nenhum turno permitido encontrado. Ajuste a busca ou peça ao administrador para conferir a configuração aprovada.</p>}
    {cursor && <button type="button" className={buttonClass} disabled={!enabled || Boolean(task.busy)} onClick={() => void loadMore()}>Carregar mais turnos permitidos</button>}
    <div className={styles.actions}><button type="button" className={buttonClass} disabled={!enabled || Boolean(task.busy)} onClick={() => { if (!validateFields()) return; invalidateChoice(); setRetry(value => value + 1); }}>Consultar turnos permitidos novamente</button><button type="button" className={primaryClass} disabled={!enabled || Boolean(task.busy) || !chosen} onClick={() => void requestPreview()}>Conferir atribuição</button></div>
    {currentPreview && <div className={styles.stackSmall}>
      <p>{currentPreview.validationLevel === "NO_SCHEDULE" ? "Altera a referência de horário; não cria dias de trabalho nem folgas." : "Confira os dias afetados e preservados antes de salvar."}</p>
      <p>{currentPreview.affected.length} dia(s) afetado(s) · {currentPreview.preserved.length} dia(s) preservado(s). Destino: {currentPreview.target.code} · {currentPreview.target.markings.join(" / ")}.</p>
      {currentPreview.affected.length > 0 && <details><summary className={styles.disclosureTrigger}>Dias afetados</summary><ul>{currentPreview.affected.map(day => <li key={day.date}>{displayDate(day.date)} · {day.previousCatalogCode ?? "Referência local"} → {day.nextCatalogCode}</li>)}</ul></details>}
      {currentPreview.preserved.length > 0 && <details><summary className={styles.disclosureTrigger}>Dias preservados</summary><ul>{currentPreview.preserved.map(day => <li key={`${day.date}:${day.reason}`}>{displayDate(day.date)} · {({ LOCKED: "Bloqueado", MANUAL: "Ajuste manual", ABSENCE: "Afastamento", OFF: "Folga", HOLIDAY: "Feriado", NO_SHIFT: "Sem turno" } as const)[day.reason]}</li>)}</ul></details>}
      {currentPreview.validationIssues.map(issue => <p className={styles.errorText} key={JSON.stringify(issue)}>{issue.message}</p>)}
      <button type="button" className={primaryClass} disabled={!enabled || Boolean(task.busy) || !currentPreview.canApply} onClick={() => void apply()}>Confirmar e salvar atribuição</button>
    </div>}
    {task.busy && <p role="status">{task.busy} <button type="button" className={buttonClass} onClick={task.cancel}>Cancelar espera</button></p>}
    {!enabled && <p className={styles.muted}>Salve a edição aberta e use uma pessoa com referência de horário controlado em rascunho. Publicações, registros protegidos e configurações aprovadas são preservados.</p>}
  </section>;
}
