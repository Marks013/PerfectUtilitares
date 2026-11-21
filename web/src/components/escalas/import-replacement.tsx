"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImportSyncPreview, ImportSyncPurpose } from "@/lib/escalas/import-sync-contracts";
import { importSyncCommandSchema } from "@/lib/escalas/import-sync-contracts";
import { isDate } from "@/lib/escalas/dates";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { useEscalaClientAccess } from "./access-context";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import type { ReplaceImport } from "./import-replacement-client";
import styles from "./escalas.module.css";
import local from "./import-replacement.module.css";

export type ImportReplacementProps = { workspace: EscalaWorkspace; disabled: boolean; operationPending?: boolean; pendingSave?: boolean; onSave?: () => void; replaceImport: ReplaceImport };
const layouts = { ESCALA_TEMPLATE: "Modelo de equipe", FPRE136: "Relatório de equipe FPRE136", FPHI105: "Relatório de afastamentos FPHI105", UNRECOGNIZED: "Formato não reconhecido" };
const dateLabel = (value: string) => value.split("-").reverse().join("/");
const quantity = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
const kindLabels = { WORK: "Trabalho", DUTY: "Presença", OFF: "Folga", ABSENCE: "Afastamento", HOLIDAY: "Feriado" };
const fieldLabels: Record<string, string> = { name: "nome", sector: "setor", role: "cargo", registration: "matrícula", shiftIds: "referências de horário", activeFrom: "início do vínculo", activeUntil: "fim do vínculo", weeklyHours: "carga semanal", maxConsecutiveSundays: "regra de domingos", sourceSchedule: "horário informado no relatório", scheduleMode: "tipo de horário", weeklyHoursMode: "origem da carga semanal" };

export function replacementDateErrors(start: string, end: string, bounds: { startDate: string; endDate: string }) {
  const check = (date: string, label: string) => !date ? `Informe a data ${label}.`
    : !isDate(date) ? `Informe uma data ${label} real.`
    : date < bounds.startDate || date > bounds.endDate ? `Escolha a data ${label} entre ${dateLabel(bounds.startDate)} e ${dateLabel(bounds.endDate)}.` : undefined;
  const errors = { start: check(start, "inicial"), end: check(end, "final") };
  if (!errors.start && !errors.end) {
    if (end < start) errors.end = "A data final precisa ser igual ou posterior à data inicial.";
    else if (Date.parse(end) - Date.parse(start) > 41 * 86_400_000) errors.end = "Escolha uma data final que complete um intervalo de até 42 dias.";
  }
  return errors;
}

export function ImportReplacement(props: ImportReplacementProps & { purpose: ImportSyncPurpose }) {
  const access = useEscalaClientAccess();
  const identity = useRef({ access, epoch: 0 });
  if (identity.current.access !== access) identity.current = { access, epoch: identity.current.epoch + 1 };
  const [locked, setLocked] = useState(false), [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const lock = () => setLocked(true), unlock = () => { setLocked(false); setEpoch(value => value + 1); };
    window.addEventListener("escalas:unlock-required", lock); window.addEventListener("escalas:unlocked", unlock);
    return () => { window.removeEventListener("escalas:unlock-required", lock); window.removeEventListener("escalas:unlocked", unlock); };
  }, []);
  if (locked || access?.channel !== "ACCOUNT" || !access.administrator || !access.allBranches) return null;
  return <Fragment key={`${identity.current.epoch}:${epoch}:${props.workspace.id}:${props.purpose}`}><ReplacementSession {...props} /></Fragment>;
}

function ReplacementSession({ workspace, purpose, disabled: permanentlyDisabled, operationPending = false, pendingSave = false, onSave, replaceImport }: ImportReplacementProps & { purpose: ImportSyncPurpose }) {
  const disabled = permanentlyDisabled || operationPending;
  const employees = purpose === "EMPLOYEES", title = employees ? "equipe" : "afastamentos";
  const [file, setFile] = useState<File | null>(null), [coverage, setCoverage] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [start, setStart] = useState(workspace.input.startDate), [end, setEnd] = useState(workspace.input.endDate);
  const [preview, setPreview] = useState<ImportSyncPreview | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [dateErrors, setDateErrors] = useState<{ start?: string; end?: string }>({});
  const errorRef = useRef<HTMLDivElement>(null), startRef = useRef<HTMLInputElement>(null), endRef = useRef<HTMLInputElement>(null), fileRef = useRef<HTMLInputElement>(null), previewRef = useRef<HTMLElement>(null);
  const active = useRef<AbortController | null>(null), alive = useRef(true);
  const context = JSON.stringify([workspace.id, workspace.revision, workspace.status, workspace.input.branchCode, workspace.input.startDate, workspace.input.endDate, workspace.input.visibleMonth, permanentlyDisabled, pendingSave]);
  const latestContext = useRef(context); latestContext.current = context;
  const uncertain = "A gravação pode ter sido concluída. Recarregue o planejamento e confira a revisão antes de repetir. Cancelar a espera não desfaz uma gravação.";
  const invalidate = useCallback(() => { active.current?.abort(); active.current = null; setPreview(null); setConfirmed(false); setBusy(""); setError(""); setDateErrors({}); setNotice(""); }, []);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
  useEffect(() => { void context; invalidate(); }, [context, invalidate]);
  useEffect(() => { setStart(workspace.input.startDate); setEnd(workspace.input.endDate); setCoverage(false); }, [workspace.input.startDate, workspace.input.endDate]);
  useEffect(() => { if (error) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: "center" }); } }, [error]);
  useLayoutEffect(() => { if (dateErrors.start) startRef.current?.focus(); else if (dateErrors.end) endRef.current?.focus(); }, [dateErrors]);
  function datesValid() {
    const errors = replacementDateErrors(start, end, workspace.input);
    setDateErrors(errors);
    if (errors.start || errors.end) return false;
    const parsed = importSyncCommandSchema.safeParse({ action: "PREVIEW_REPLACE", purpose, workspaceId: workspace.id, expectedRevision: workspace.revision, startDate: start, endDate: end, completeScopeConfirmed: coverage });
    if (!parsed.success) { setError("O contexto do planejamento não foi confirmado. Recarregue o planejamento antes de conferir o arquivo."); return false; }
    return true;
  }
  async function execute(apply: boolean) {
    if (active.current || disabled || pendingSave) return;
    if (!file) { fileRef.current?.focus(); return; }
    if (!datesValid()) return;
    if (apply && (!preview?.canApply || preview.blockers.length || !confirmed || !coverage)) return;
    const current = new AbortController(), snapshot = context, checked = preview;
    active.current = current; setBusy(apply ? "Salvando substituição…" : "Conferindo arquivo e consequências…"); setError(""); setNotice("");
    if (!apply) { setPreview(null); setConfirmed(false); }
    try {
      const base = { purpose, workspaceId: workspace.id, expectedRevision: workspace.revision, startDate: start, endDate: end, completeScopeConfirmed: coverage };
      const command = apply && checked ? { ...base, action: "APPLY_REPLACE" as const, completeScopeConfirmed: true as const, confirm: true as const, expectedImpactHash: checked.expectedImpactHash } : { ...base, action: "PREVIEW_REPLACE" as const };
      const result = await replaceImport(file, command, current.signal);
      if (!alive.current || current.signal.aborted || active.current !== current || latestContext.current !== snapshot) return;
      if (!result) throw new Error("A operação não foi confirmada. Confira o estado do planejamento.");
      if ("preview" in result) { setPreview(result.preview); requestAnimationFrame(() => { if (alive.current && !current.signal.aborted && latestContext.current === snapshot && active.current === null) { previewRef.current?.focus(); previewRef.current?.scrollIntoView({ block: "center" }); } }); }
      else { setPreview(null); setConfirmed(false); setNotice(`Substituição salva na revisão ${result.workspace.revision}. Confira a escala antes de gerar ou publicar.`); }
    } catch (cause) {
      if (alive.current && !current.signal.aborted && active.current === current && latestContext.current === snapshot) {
        setPreview(null); setConfirmed(false); setError(`${cause instanceof Error ? cause.message : "Não foi possível confirmar a operação."}${apply ? ` ${uncertain}` : " Nenhuma substituição foi solicitada."}`);
      }
    } finally { if (alive.current && active.current === current) { active.current = null; setBusy(""); } }
  }
  const people = new Map(workspace.input.employees.map(p => [p.id, p.name]));
  const labelPerson = (id: string, registration: string) => `${registration || "Sem matrícula"} · ${people.get(id) ?? "Pessoa incluída pelo arquivo"}`;
  return <details className={`${panelClass} ${local.root}`} open={employees && !workspace.input.employees.length || undefined}>
    <summary className={styles.disclosureTrigger}>Importar e substituir {title}</summary>
    <p>Filial {workspace.input.branchCode} · {workspace.input.branchName} · revisão {workspace.revision}. Planejamento completo: {dateLabel(workspace.input.startDate)} a {dateLabel(workspace.input.endDate)}, incluindo bordas de outros meses.</p>
    <p className={styles.muted}>{employees ? "O arquivo completo acrescenta novos colaboradores, atualiza os presentes e retira os ausentes desta equipe. Dados não fornecidos e revisões anteriores são preservados." : "O arquivo completo substitui os afastamentos no intervalo escolhido. Dias antigos ausentes no arquivo serão retirados e ficarão sem atribuição; não será inventado trabalho ou folga. Não classifica férias e não importa dados médicos."} Outras filiais e outros planejamentos não serão alterados.</p>
    {pendingSave && <p role="status">Há alterações pendentes. <button type="button" className={buttonClass} disabled={disabled || Boolean(busy)} onClick={onSave}>Salvar alterações antes de conferir</button></p>}
    {disabled && <p className={styles.muted}>Conclua a operação, a proposta ou a recuperação pendente. Resolva conflitos antes de importar.</p>}
    <Field label={employees ? "Arquivo de equipe CSV ou XLSX" : "Arquivo de afastamentos CSV"}>{id => <input ref={fileRef} id={id} className={controlClass} type="file" accept={employees ? ".csv,.xlsx" : ".csv"} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(false); setFile(event.target.files?.[0] ?? null); }} />}</Field>
    {employees ? <p>Será conferida a equipe de todo o intervalo acima. Relatório apenas do mês visível não autoriza excluir pessoas das bordas.</p> : <div className={styles.formGrid}>
      <Field label="Substituir afastamentos a partir de" error={dateErrors.start}>{id => <input ref={startRef} id={id} className={controlClass} type="date" min={workspace.input.startDate} max={workspace.input.endDate} value={start} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(false); setStart(event.target.value); }} />}</Field>
      <Field label="Substituir afastamentos até" error={dateErrors.end}>{id => <input ref={endRef} id={id} className={controlClass} type="date" min={workspace.input.startDate} max={workspace.input.endDate} value={end} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(false); setEnd(event.target.value); }} />}</Field>
    </div>}
    <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={coverage} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(event.target.checked); }} />Declaro que o arquivo cobre integralmente {employees ? "a equipe desta filial em todo o planejamento" : "os afastamentos desta filial no intervalo escolhido"}. Vou conferir todas as remoções.</label>
    <p className={styles.muted}>Esta declaração não comprova o arquivo automaticamente e não libera arquivo identificado como parcial, vazio, inválido ou ambíguo.</p>
    <button type="button" className={buttonClass} disabled={disabled || pendingSave || Boolean(busy) || !file} onClick={() => void execute(false)}>Conferir substituição de {title}</button>
    {busy && <p role="status">{busy} <button type="button" className={buttonClass} onClick={() => { const applying = busy.startsWith("Salvando"); invalidate(); setError(applying ? uncertain : "Espera cancelada. Confira novamente quando desejar continuar."); }}>Cancelar espera da importação</button></p>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.feedbackFocus}><p>{error}</p></div>}
    {notice && <p role="status">{notice}</p>}
    {preview && <section ref={previewRef} tabIndex={-1} aria-label="Conferência da substituição" className={`${styles.stackSmall} ${local.review}`}>
      <h3 className={styles.sectionTitle}>Confira o que será substituído</h3>
      <p>{layouts[preview.layout]} · filial {preview.context.branchCode} · revisão {preview.context.revision} · {dateLabel(preview.scope.startDate)} a {dateLabel(preview.scope.endDate)}.</p>
      <p>{preview.coverage.sourcePeriod ? `Período identificado no relatório: ${dateLabel(preview.coverage.sourcePeriod.startDate)} a ${dateLabel(preview.coverage.sourcePeriod.endDate)}.` : "O arquivo não comprova automaticamente o período completo; a cobertura depende da declaração administrativa."}</p>
      <p>{employees ? `${quantity(preview.counts.addedPeople, "pessoa incluída", "pessoas incluídas")} · ${quantity(preview.counts.updatedPeople, "pessoa atualizada", "pessoas atualizadas")} · ${quantity(preview.counts.removedPeople, "pessoa retirada", "pessoas retiradas")} · ${quantity(preview.counts.unchangedPeople, "pessoa mantida", "pessoas mantidas")}.` : `${quantity(preview.counts.addedAbsenceDays, "dia de afastamento incluído", "dias de afastamento incluídos")} · ${quantity(preview.counts.removedAbsenceDays, "dia retirado", "dias retirados")} · ${quantity(preview.counts.unchangedAbsenceDays, "dia mantido", "dias mantidos")}.`} {quantity(preview.counts.assignmentChanges, "atribuição alterada", "atribuições alteradas")}.</p>
      {employees && ([ ["added", "Pessoas incluídas"], ["updated", "Pessoas atualizadas"], ["removed", "Pessoas retiradas"], ["unchanged", "Pessoas mantidas"] ] as const).map(([key, label]) => <details key={key} open={key === "removed" && preview.impact.people[key].length > 0}><summary className={styles.disclosureTrigger}>{label} ({preview.impact.people[key].length})</summary><ul>{preview.impact.people[key].map(p => <li key={p.id}>{p.registration} · {p.name}{p.fields.length > 0 ? ` · Campos: ${p.fields.map(field => fieldLabels[field] ?? "outro dado informado no arquivo").join(", ")}` : ""}</li>)}</ul></details>)}
      {(!employees || preview.counts.addedAbsenceDays + preview.counts.removedAbsenceDays + preview.counts.unchangedAbsenceDays > 0) && ([ ["added", "Dias de afastamento incluídos"], ["removed", "Dias de afastamento retirados"], ["unchanged", "Dias de afastamento mantidos"] ] as const).map(([key,label]) => <details key={key} open={key === "removed" && preview.impact.absences[key].length > 0}><summary className={styles.disclosureTrigger}>{label} ({preview.impact.absences[key].length})</summary><ul>{preview.impact.absences[key].map(d => <li key={`${d.employeeId}:${d.date}`}>{labelPerson(d.employeeId,d.registration)} · {dateLabel(d.date)}</li>)}</ul></details>)}
      <details><summary className={styles.disclosureTrigger}>Atribuições e referências alteradas ({preview.impact.assignments.length + preview.impact.references.length})</summary><ul>{preview.impact.assignments.map(d => <li key={`${d.employeeId}:${d.date}`}>{labelPerson(d.employeeId,d.registration)} · {dateLabel(d.date)} · {d.previousKind ? kindLabels[d.previousKind] : "Sem atribuição"} → {d.nextKind ? kindLabels[d.nextKind] : "Sem atribuição"}</li>)}{preview.impact.references.map(r => <li key={JSON.stringify(r)}>{labelPerson(r.employeeId,r.registration)} · {r.before} → {r.after}</li>)}</ul></details>
      {preview.warnings.length > 0 && <ul aria-label="Avisos da conferência">{preview.warnings.map(p => <li key={JSON.stringify(p)}>{p.line ? `Linha ${p.line}: ` : ""}{p.message}</li>)}</ul>}
      {preview.blockers.length > 0 && <div role="alert"><h4>Resolva antes de substituir</h4><ul>{preview.blockers.map(p => <li key={JSON.stringify(p)}>{p.line ? `Linha ${p.line}: ` : ""}{p.message}</li>)}</ul><p>Corrija o arquivo ou a situação indicada e confira novamente. A declaração de cobertura não ignora estes problemas.</p></div>}
      <p>Será salva uma nova revisão de rascunho. {preview.context.status === "PUBLISHED" ? "A publicação anterior permanece no histórico. " : ""}{preview.effect.approvalInvalidated ? "A aprovação incompatível será desvinculada; será necessário conferir a configuração administrativa. " : ""}{preview.effect.needsRegeneration ? "A escala precisará ser gerada novamente após a conferência. " : ""}Nada será publicado ou gerado automaticamente.</p>
      <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={confirmed} disabled={disabled || Boolean(busy) || !preview.canApply || Boolean(preview.blockers.length) || !coverage} onChange={event => setConfirmed(event.target.checked)} />Confirmo substituir {title} da filial {preview.context.branchCode} de {dateLabel(preview.scope.startDate)} a {dateLabel(preview.scope.endDate)}, incluindo as remoções listadas, em uma nova revisão de rascunho.</label>
      <button type="button" className={primaryClass} disabled={disabled || pendingSave || Boolean(busy) || !preview.canApply || Boolean(preview.blockers.length) || !coverage || !confirmed} onClick={() => void execute(true)}>Confirmar e salvar substituição de {title}</button>
    </section>}
  </details>;
}
