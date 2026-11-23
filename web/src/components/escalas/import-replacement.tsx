"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImportSyncCommand, ImportSyncPreview, ImportSyncPurpose } from "@/lib/escalas/import-sync-contracts";
import { importSyncCommandSchema, isImportSyncFileSizeAllowed } from "@/lib/escalas/import-sync-contracts";
import { addDays, isDate } from "@/lib/escalas/dates";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { useEscalaClientAccess } from "./access-context";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { importReplacementFileSizeMessage, type ReplaceImport } from "./import-replacement-client";
import styles from "./escalas.module.css";
import local from "./import-replacement.module.css";

export type ImportReplacementProps = { workspace: EscalaWorkspace; disabled: boolean; operationPending?: boolean; pendingSave?: boolean; onSave?: () => void; replaceImport: ReplaceImport };
const layouts = { ESCALA_TEMPLATE: "Modelo de equipe", FPRE136: "Relatório de equipe FPRE136", FPHI105: "Relatório de afastamentos FPHI105", UNRECOGNIZED: "Formato não reconhecido" };
const dateLabel = (value: string) => value.split("-").reverse().join("/");
const quantity = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
const kindLabels = { WORK: "Trabalho", DUTY: "Presença", OFF: "Folga", ABSENCE: "Afastamento", HOLIDAY: "Feriado" };
const fieldLabels: Record<string, string> = { name: "nome", sector: "setor", role: "cargo", registration: "matrícula", shiftIds: "referências de horário", activeFrom: "início do vínculo", activeUntil: "fim do vínculo", weeklyHours: "carga semanal", maxConsecutiveSundays: "regra de domingos", sourceSchedule: "horário informado no relatório", scheduleMode: "tipo de horário", weeklyHoursMode: "origem da carga semanal" };

type Diagnostic = ImportSyncPreview["blockers"][number] | ImportSyncPreview["warnings"][number];
type DiagnosticLocation = { employeeId?: string; line?: number; dates: Set<string> };
type RegistrationRows = NonNullable<ImportSyncPreview["missingRegistrations"]>;
type RegistrationCorrections = NonNullable<ImportSyncCommand["registrationCorrections"]>;

function diagnosticGroups(diagnostics: Diagnostic[]) {
  const groups = new Map<string, { message: string; locations: Map<string, DiagnosticLocation> }>();
  for (const diagnostic of diagnostics) {
    const { code, message, employeeId, line } = diagnostic;
    const date = "date" in diagnostic ? diagnostic.date : undefined;
    const reason = JSON.stringify([code, message]);
    const group = groups.get(reason) ?? { message, locations: new Map() };
    groups.set(reason, group);
    if (line === undefined && !employeeId && !date) continue;
    const key = JSON.stringify([employeeId, line]);
    const location = group.locations.get(key) ?? { employeeId, line, dates: new Set<string>() };
    if (date) location.dates.add(date);
    group.locations.set(key, location);
  }
  return groups;
}

function dateRanges(dates: Set<string>) {
  const ranges: { start: string; end: string }[] = [];
  for (const date of [...dates].sort()) {
    const last = ranges.at(-1);
    if (last && addDays(last.end, 1) === date) last.end = date;
    else ranges.push({ start: date, end: date });
  }
  return ranges.map(({ start, end }) => start === end ? dateLabel(start) : `${dateLabel(start)} a ${dateLabel(end)}`).join(", ");
}

function Diagnostics({ diagnostics, blocking = false, personLabel }: { diagnostics: Diagnostic[]; blocking?: boolean; personLabel: (id: string) => string }) {
  if (!diagnostics.length) return null;
  const groups = diagnosticGroups(diagnostics);
  return <div className={local.diagnostics} data-tone={blocking ? "error" : "warning"}>
    <div role={blocking ? "alert" : undefined}>
      <h4>{blocking ? "Resolva antes de substituir" : "Avisos que não bloqueiam"}</h4>
      <p>{blocking
        ? `${quantity(groups.size, "motivo bloqueante", "motivos bloqueantes")}. Corrija o arquivo ou a situação indicada e confira novamente.`
        : `${quantity(groups.size, "tipo de aviso", "tipos de aviso")}. Nenhum destes avisos impede a substituição por si só.`}</p>
    </div>
    <ul className={local.reasons} aria-label={blocking ? "Motivos do bloqueio" : "Avisos da conferência"}>
      {[...groups].map(([key, group]) => <li key={key}>
        <p>{group.message}</p>
        {group.locations.size > 0 && <details>
          <summary className={styles.disclosureTrigger}>Ver detalhes ({quantity([...group.locations.values()].reduce((total, location) => total + Math.max(1, location.dates.size), 0), "ocorrência", "ocorrências")})</summary>
          <ul>{[...group.locations].map(([locationKey, { employeeId, line, dates }]) => <li key={locationKey}>
            {[employeeId && personLabel(employeeId), line !== undefined && `Linha ${line}`, dates.size > 0 && dateRanges(dates)].filter(Boolean).join(" · ")}
          </li>)}</ul>
        </details>}
      </li>)}
    </ul>
  </div>;
}

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
  const [registrationRows, setRegistrationRows] = useState<RegistrationRows>([]);
  const [registrations, setRegistrations] = useState<Record<number, string>>({});
  const [numericRegistration, setNumericRegistration] = useState(false);
  const checkedCorrections = useRef<RegistrationCorrections>([]);
  const registrationRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null), startRef = useRef<HTMLInputElement>(null), endRef = useRef<HTMLInputElement>(null), fileRef = useRef<HTMLInputElement>(null), previewRef = useRef<HTMLElement>(null);
  const active = useRef<AbortController | null>(null), alive = useRef(true);
  const previewFocus = useRef<{ context: string; signal: AbortSignal } | null>(null);
  const context = JSON.stringify([workspace.id, workspace.revision, workspace.status, workspace.input.branchCode, workspace.input.startDate, workspace.input.endDate, workspace.input.visibleMonth, permanentlyDisabled, pendingSave]);
  const latestContext = useRef(context); latestContext.current = context;
  const uncertain = "A gravação pode ter sido concluída. Recarregue o planejamento e confira a revisão antes de repetir. Cancelar a espera não desfaz uma gravação.";
  const invalidate = useCallback(() => { active.current?.abort(); active.current = null; previewFocus.current = null; checkedCorrections.current = []; setPreview(null); setConfirmed(false); setBusy(""); setError(""); setDateErrors({}); setNotice(""); }, []);
  const resetRegistrations = useCallback(() => { setRegistrationRows([]); setRegistrations({}); setNumericRegistration(false); }, []);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
  useEffect(() => { void context; invalidate(); resetRegistrations(); }, [context, invalidate, resetRegistrations]);
  useEffect(() => { setStart(workspace.input.startDate); setEnd(workspace.input.endDate); setCoverage(false); }, [workspace.input.startDate, workspace.input.endDate]);
  useEffect(() => { if (error) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: "center" }); } }, [error]);
  useLayoutEffect(() => { if (dateErrors.start) startRef.current?.focus(); else if (dateErrors.end) endRef.current?.focus(); }, [dateErrors]);
  useLayoutEffect(() => {
    const focus = previewFocus.current;
    if (!preview || busy || !focus) return;
    previewFocus.current = null;
    if (focus.context !== context || focus.signal.aborted || active.current) return;
    const field = preview.missingRegistrations?.some(row => !row.resolved)
      ? registrationRef.current?.querySelector<HTMLInputElement>("input[aria-invalid='true']")
      : undefined;
    const target = field ?? previewRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  }, [preview, busy, context]);
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
    if (!isImportSyncFileSizeAllowed(file.size)) { setError(importReplacementFileSizeMessage); return; }
    if (!datesValid()) return;
    if (apply && (!preview?.canApply || preview.effect.noChanges || preview.blockers.length || preview.missingRegistrations?.some(row => !row.resolved) || !confirmed || !coverage)) return;
    const corrections = apply ? checkedCorrections.current : registrationRows.flatMap(({ line }) => {
      const registration = registrations[line]?.trim();
      return registration ? [{ line, registration }] : [];
    });
    if (numericRegistration && corrections.some(({ registration }) => !/^\d+$/.test(registration))) {
      setError("Informe somente números na matrícula do relatório FPRE136 e confira novamente.");
      return;
    }
    const current = new AbortController(), snapshot = context, checked = preview;
    active.current = current; setBusy(apply ? "Salvando substituição…" : "Conferindo arquivo e consequências…"); setError(""); setNotice("");
    if (!apply) { checkedCorrections.current = []; setPreview(null); setConfirmed(false); }
    try {
      const base = { purpose, workspaceId: workspace.id, expectedRevision: workspace.revision, startDate: start, endDate: end, completeScopeConfirmed: coverage,
        ...(corrections.length ? { registrationCorrections: corrections } : {}) };
      const command = apply && checked ? { ...base, action: "APPLY_REPLACE" as const, completeScopeConfirmed: true as const, confirm: true as const, expectedImpactHash: checked.expectedImpactHash } : { ...base, action: "PREVIEW_REPLACE" as const };
      const result = await replaceImport(file, command, current.signal);
      if (!alive.current || current.signal.aborted || active.current !== current || latestContext.current !== snapshot) return;
      if (!result) throw new Error("A operação não foi confirmada. Confira o estado do planejamento.");
      if ("preview" in result) {
        previewFocus.current = { context: snapshot, signal: current.signal };
        checkedCorrections.current = corrections;
        setRegistrationRows(result.preview.missingRegistrations ?? []);
        setNumericRegistration(result.preview.layout === "FPRE136");
        setPreview(result.preview);
      }
      else { checkedCorrections.current = []; resetRegistrations(); setPreview(null); setConfirmed(false); setNotice(`Substituição salva na revisão ${result.workspace.revision}. Confira a escala antes de gerar ou publicar.`); }
    } catch (cause) {
      if (alive.current && !current.signal.aborted && active.current === current && latestContext.current === snapshot) {
        setPreview(null); setConfirmed(false); setError(`${cause instanceof Error ? cause.message : "Não foi possível confirmar a operação."}${apply ? ` ${uncertain}` : " Nenhuma substituição foi solicitada."}`);
      }
    } finally { if (alive.current && active.current === current) { active.current = null; setBusy(""); } }
  }
  const people = new Map(workspace.input.employees.map(p => [p.id, p.name]));
  const labelPerson = (id: string, registration: string) => `${registration || "Sem matrícula"} · ${people.get(id) ?? "Pessoa incluída pelo arquivo"}`;
  const { startDate, endDate, visibleMonth } = workspace.input;
  const hasMonthEdges = visibleMonth && (!startDate.startsWith(visibleMonth) || !endDate.startsWith(visibleMonth));
  const reviewPeople = new Map([
    ...workspace.input.employees.map(p => [p.id, labelPerson(p.id, p.registration)] as const),
    ...(preview ? Object.values(preview.impact.people).flat().map(p => [p.id, `${p.registration} · ${p.name}`] as const) : []),
  ]);
  return <details className={`${panelClass} ${local.root}`} open={employees && !workspace.input.employees.length || undefined}>
    <summary className={styles.disclosureTrigger}>Importar e substituir {title}</summary>
    <p>Filial {workspace.input.branchCode} · {workspace.input.branchName} · revisão {workspace.revision}. Planejamento completo: {dateLabel(startDate)} a {dateLabel(endDate)}{hasMonthEdges ? ", incluindo bordas de outros meses" : ""}.</p>
    <p className={styles.muted}>{employees ? "O arquivo completo define a equipe deste período. Os registros do arquivo substituem os dados correspondentes, colaboradores removidos manualmente podem voltar e quem não estiver no arquivo poderá sair. A revisão anterior fica no histórico. A equipe confirmada será usada nos próximos planejamentos aprovados desta filial." : "O arquivo completo substitui os afastamentos no intervalo escolhido. Dias antigos ausentes no arquivo serão retirados e ficarão sem atribuição; não será inventado trabalho ou folga. Não classifica férias e não importa dados médicos."} Outras filiais e outros planejamentos existentes não serão alterados.</p>
    {pendingSave && <p role="status">Há alterações pendentes. <button type="button" className={buttonClass} disabled={disabled || Boolean(busy)} onClick={onSave}>Salvar alterações antes de conferir</button></p>}
    {disabled && <p className={styles.muted}>Conclua a operação, a proposta ou a recuperação pendente. Resolva conflitos antes de importar.</p>}
    <Field label={employees ? "Arquivo de equipe CSV ou XLSX" : "Arquivo de afastamentos CSV"}>{id => <input ref={fileRef} id={id} className={controlClass} type="file" accept={employees ? ".csv,.xlsx" : ".csv"} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); resetRegistrations(); setCoverage(false); setFile(event.target.files?.[0] ?? null); }} />}</Field>
    {employees ? <p>Será conferida a equipe de todo o intervalo acima.{hasMonthEdges ? " Relatório apenas do mês visível não autoriza excluir pessoas das bordas." : ""}</p> : <div className={styles.formGrid}>
      <Field label="Substituir afastamentos a partir de" error={dateErrors.start}>{id => <input ref={startRef} id={id} className={controlClass} type="date" min={workspace.input.startDate} max={workspace.input.endDate} value={start} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(false); setStart(event.target.value); }} />}</Field>
      <Field label="Substituir afastamentos até" error={dateErrors.end}>{id => <input ref={endRef} id={id} className={controlClass} type="date" min={workspace.input.startDate} max={workspace.input.endDate} value={end} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(false); setEnd(event.target.value); }} />}</Field>
    </div>}
    <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={coverage} disabled={disabled || Boolean(busy)} onChange={event => { invalidate(); setCoverage(event.target.checked); }} />Declaro que o arquivo cobre integralmente {employees ? "a equipe desta filial em todo o planejamento" : "os afastamentos desta filial no intervalo escolhido"}. Vou conferir todas as remoções.</label>
    <p className={styles.muted}>Esta declaração não comprova o arquivo automaticamente e não libera arquivo identificado como parcial, vazio, inválido ou ambíguo.</p>
    {employees && registrationRows.length > 0 && <section ref={registrationRef} aria-label="Matrículas do arquivo" className={local.registrations}>
      <h3>Matrículas ausentes no arquivo</h3>
      <p>Informe a matrícula oficial de cada pessoa, incluindo os zeros à esquerda. Se a pessoa já tem matrícula, mantenha o mesmo número, mesmo que tenha mudado de filial. Nenhuma matrícula será deduzida pelo nome.</p>
      <p>Confira a substituição novamente depois de preencher ou alterar um campo.</p>
      <div className={local.registrationFields}>{registrationRows.map(row => {
        const value = registrations[row.line] ?? "";
        const currentRow = preview?.missingRegistrations?.find(item => item.line === row.line);
        const blocker = preview?.blockers.find(item => item.line === row.line && (item.code === "SOURCE_IDENTITY" || item.code === "SOURCE_PARTIAL"));
        const fieldError = numericRegistration && value.trim() && !/^\d+$/.test(value.trim()) ? "Informe somente números."
          : blocker?.message ?? (currentRow && !currentRow.resolved ? "Informe a matrícula para conferir a substituição." : undefined);
        return <Field key={row.line} label={`Matrícula — ${row.name} (linha ${row.line})`} hint={[row.sector, row.role].filter(Boolean).join(" · ") || undefined} error={fieldError}>
          {(id, accessibility) => <input {...accessibility} id={id} className={controlClass} type="text" inputMode={numericRegistration ? "numeric" : "text"} maxLength={60}
            autoComplete="off" spellCheck={false} value={value} disabled={disabled || pendingSave || Boolean(busy)}
            onChange={event => { const registration = event.target.value; invalidate(); setRegistrations(previous => ({ ...previous, [row.line]: registration })); }} />}
        </Field>;
      })}</div>
    </section>}
    <button type="button" className={buttonClass} disabled={disabled || pendingSave || Boolean(busy) || !file} onClick={() => void execute(false)}>Conferir substituição de {title}</button>
    {busy && <p role="status">{busy} <button type="button" className={buttonClass} onClick={() => { const applying = busy.startsWith("Salvando"); invalidate(); setError(applying ? uncertain : "Espera cancelada. Confira novamente quando desejar continuar."); }}>Cancelar espera da importação</button></p>}
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.feedbackFocus}><p>{error}</p></div>}
    {notice && <p role="status">{notice}</p>}
    {preview && <section ref={previewRef} tabIndex={-1} aria-label="Conferência da substituição" className={`${styles.stackSmall} ${local.review}`}>
      <h3 className={styles.sectionTitle}>Confira o que será substituído</h3>
      <p>{layouts[preview.layout]} · filial {preview.context.branchCode} · revisão {preview.context.revision} · {dateLabel(preview.scope.startDate)} a {dateLabel(preview.scope.endDate)}.</p>
      <p>{preview.coverage.sourcePeriod ? `Período identificado no relatório: ${dateLabel(preview.coverage.sourcePeriod.startDate)} a ${dateLabel(preview.coverage.sourcePeriod.endDate)}.` : employees ? "Confira se o arquivo contém toda a equipe da filial no intervalo. A prévia usa a declaração administrativa." : "Não foi possível confirmar o período completo no relatório de afastamentos."}</p>
      <Diagnostics diagnostics={preview.blockers} blocking personLabel={id => reviewPeople.get(id) ?? "Colaborador não identificado na prévia"} />
      <p>{employees ? `${quantity(preview.counts.addedPeople, "pessoa incluída", "pessoas incluídas")} · ${quantity(preview.counts.updatedPeople, "pessoa atualizada", "pessoas atualizadas")} · ${quantity(preview.counts.removedPeople, "pessoa retirada", "pessoas retiradas")} · ${quantity(preview.counts.unchangedPeople, "pessoa mantida", "pessoas mantidas")}.` : `${quantity(preview.counts.addedAbsenceDays, "dia de afastamento incluído", "dias de afastamento incluídos")} · ${quantity(preview.counts.removedAbsenceDays, "dia retirado", "dias retirados")} · ${quantity(preview.counts.unchangedAbsenceDays, "dia mantido", "dias mantidos")}.`} {quantity(preview.counts.assignmentChanges, "atribuição alterada", "atribuições alteradas")}.</p>
      {employees && ([ ["removed", "Pessoas retiradas"], ["added", "Pessoas incluídas"], ["updated", "Pessoas atualizadas"], ["unchanged", "Pessoas mantidas"] ] as const).filter(([key]) => preview.impact.people[key].length > 0).map(([key, label]) => <details key={key} open={key === "removed"} className={key === "removed" ? local.departures : undefined}>
        <summary className={styles.disclosureTrigger}>{label} ({preview.impact.people[key].length})</summary>
        {key === "removed" && <p>Estas pessoas não constam no arquivo. Se você salvar a substituição, elas sairão da equipe deste rascunho. Isso não registra uma demissão nem define uma data de desligamento.</p>}
        <ul>{preview.impact.people[key].map(p => <li key={p.id}>{p.registration} · {p.name}{p.fields.length > 0 ? ` · Campos: ${p.fields.map(field => fieldLabels[field] ?? "outro dado informado no arquivo").join(", ")}` : ""}</li>)}</ul>
      </details>)}
      {(!employees || preview.counts.addedAbsenceDays + preview.counts.removedAbsenceDays + preview.counts.unchangedAbsenceDays > 0) && ([ ["added", "Dias de afastamento incluídos"], ["removed", "Dias de afastamento retirados"], ["unchanged", "Dias de afastamento mantidos"] ] as const).map(([key,label]) => <details key={key} open={key === "removed" && preview.impact.absences[key].length > 0}><summary className={styles.disclosureTrigger}>{label} ({preview.impact.absences[key].length})</summary><ul>{preview.impact.absences[key].map(d => <li key={`${d.employeeId}:${d.date}`}>{labelPerson(d.employeeId,d.registration)} · {dateLabel(d.date)}</li>)}</ul></details>)}
      <details><summary className={styles.disclosureTrigger}>Atribuições e referências alteradas ({preview.impact.assignments.length + preview.impact.references.length})</summary><ul>{preview.impact.assignments.map(d => <li key={`${d.employeeId}:${d.date}`}>{labelPerson(d.employeeId,d.registration)} · {dateLabel(d.date)} · {d.previousKind ? kindLabels[d.previousKind] : "Sem atribuição"} → {d.nextKind ? kindLabels[d.nextKind] : "Sem atribuição"}</li>)}{preview.impact.references.map(r => <li key={JSON.stringify(r)}>{labelPerson(r.employeeId,r.registration)} · {r.before} → {r.after}</li>)}</ul></details>
      <Diagnostics diagnostics={preview.warnings} personLabel={id => reviewPeople.get(id) ?? "Colaborador não identificado na prévia"} />
      {preview.effect.noChanges ? <p role="status">Nenhuma alteração na equipe. O planejamento e a revisão atual foram mantidos.</p> : <>
        {preview.canApply && <p>Será salva uma nova revisão de rascunho. {preview.context.status === "PUBLISHED" ? "A publicação anterior permanece no histórico. " : ""}{preview.effect.approvalInvalidated ? "A aprovação incompatível será desvinculada; será necessário conferir a configuração administrativa. " : ""}{preview.effect.needsRegeneration ? "A escala precisará ser gerada novamente após a conferência. " : ""}Nada será publicado ou gerado automaticamente.</p>}
        <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={confirmed} disabled={disabled || Boolean(busy) || !preview.canApply || Boolean(preview.blockers.length) || !coverage} onChange={event => setConfirmed(event.target.checked)} />Confirmo substituir {title} da filial {preview.context.branchCode} de {dateLabel(preview.scope.startDate)} a {dateLabel(preview.scope.endDate)}, incluindo as remoções listadas, em uma nova revisão de rascunho.</label>
        <button type="button" className={primaryClass} disabled={disabled || pendingSave || Boolean(busy) || !preview.canApply || Boolean(preview.blockers.length) || !coverage || !confirmed} onClick={() => void execute(true)}>Confirmar e salvar substituição de {title}</button>
      </>}
    </section>}
  </details>;
}
