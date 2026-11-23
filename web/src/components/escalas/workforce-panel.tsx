"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";
import {
  applyWorkforceImport, changeWorkforce, previewWorkforceImport, readWorkforce,
  type WorkforceAbsence, type WorkforceChange, type WorkforceImportPreview, type WorkforceImportPurpose,
  type WorkforcePerson, type WorkforceRegistrationCorrection, type WorkforceSnapshot,
} from "./workforce-panel-client";

type PanelProps = { branchCode: string; canImport: boolean; onChanged?: () => void | Promise<void> };
type Mutate = (command: WorkforceChange) => Promise<boolean>;
type ImportReview = { file: File; purpose: WorkforceImportPurpose; corrections: WorkforceRegistrationCorrection[]; preview: WorkforceImportPreview };
type Run = <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;
const describeError = (error: unknown) => error instanceof Error ? error.message : "Não foi possível acessar a base de pessoal.";
const labelDate = (iso: string) => iso.split("-").reverse().join("/");
const value = (form: FormData, field: string) => String(form.get(field) ?? "").trim();

export function EscalaWorkforcePanel(props: PanelProps) {
  return props.branchCode ? <BranchWorkforcePanel key={`${props.branchCode}:${props.canImport}`} {...props} /> : null;
}

function BranchWorkforcePanel({ branchCode, canImport, onChanged }: PanelProps) {
  const [snapshot, setSnapshot] = useState<WorkforceSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registration, setRegistration] = useState("");
  const reader = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(async () => {
    reader.current?.abort();
    const request = new AbortController();
    reader.current = request;
    setLoading(true);
    setError("");
    try {
      const updated = await readWorkforce(branchCode, request.signal);
      if (!request.signal.aborted) setSnapshot(updated);
    } catch (cause) {
      if (!request.signal.aborted) { setSnapshot(undefined); setError(describeError(cause)); }
    } finally {
      if (reader.current === request && !request.signal.aborted) setLoading(false);
    }
  }, [branchCode]);

  useEffect(() => {
    void refresh();
    return () => { reader.current?.abort(); writer.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const run: Run = async operation => {
    if (writer.current || loading) return undefined;
    const request = new AbortController();
    writer.current = request;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation(request.signal);
      return request.signal.aborted ? undefined : result;
    } catch (cause) {
      if (!request.signal.aborted) setError(describeError(cause));
      return undefined;
    } finally {
      if (writer.current === request && !request.signal.aborted) {
        writer.current = null;
        setBusy(false);
      }
    }
  };

  async function updated(result: { revision: number; changed: boolean }) {
    setNotice(result.changed ? `Base de pessoal atualizada. Revisão ${result.revision}.` : "Nenhuma alteração na base de pessoal.");
    if (!result.changed) return;
    await refresh();
    if (reader.current?.signal.aborted) return;
    try { await onChanged?.(); }
    catch {
      if (!reader.current?.signal.aborted) setNotice("A base foi atualizada. Recarregue o planejamento para conferir o rascunho.");
    }
  }

  const mutate: Mutate = async command => {
    if (!snapshot) return false;
    const result = await run(signal => changeWorkforce(branchCode, snapshot.revision, command, signal));
    if (!result) return false;
    await updated(result);
    return true;
  };

  const disabled = loading || busy || !snapshot;
  const people = [...snapshot?.people ?? []].sort((a, b) => a.employee.name.localeCompare(b.employee.name, "pt-BR") || a.employee.registration.localeCompare(b.employee.registration));
  const person = people.find(item => item.employee.registration === registration);
  const absences = snapshot?.absences.filter(item => item.registration === registration) ?? [];
  return <details className={panelClass} aria-busy={busy || loading}>
    <summary className={styles.disclosureTrigger}>Base de pessoal · filial {branchCode}</summary>
    <div className={styles.stackSmall}>
      <p className={styles.muted}>Colaboradores e afastamentos da filial são usados nos rascunhos em todos os meses. Alterações não modificam publicações anteriores.</p>
      {snapshot && <p className={styles.statusTag}>{snapshot.revision ? `Revisão ${snapshot.revision} · ${people.length} colaborador(es)` : "Base ainda não inicializada"}</p>}
      {(busy || loading) && <p role="status">{busy ? "Processando alteração na base de pessoal…" : "Carregando a base de pessoal…"}</p>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.errorText}>{error}</p>}
      {notice && <p role="status" className={styles.muted}>{notice}</p>}
      <div className={styles.actions}><button type="button" className={buttonClass} disabled={loading || busy} onClick={() => void refresh()}>Atualizar base da filial</button></div>
      {snapshot && <>
        {snapshot.catalogs.length ? <details>
          <summary className={styles.disclosureTrigger}>Cadastrar colaborador</summary>
          <PersonForm key={snapshot.revision} disabled={disabled} mutate={mutate} />
        </details> : <p className={styles.muted}>A filial precisa constar na base global antes do cadastro manual.</p>}
        <Field label="Colaborador da filial">
          {id => <select id={id} className={controlClass} value={registration} disabled={disabled || !people.length} onChange={event => setRegistration(event.target.value)}>
            <option value="">{people.length ? "Selecione" : "Nenhum colaborador cadastrado"}</option>
            {people.map(item => <option key={item.employee.registration} value={item.employee.registration}>
              {item.employee.name} · {item.employee.registration}{item.dismissedFrom ? " · Desligado" : item.listed === false ? " · Fora da lista atual" : ""}
            </option>)}
          </select>}
        </Field>
        {person && <PersonOperations key={`${registration}:${snapshot.revision}`} person={person} absences={absences} disabled={disabled} mutate={mutate} />}
        {canImport && <GlobalImport key={snapshot.revision} disabled={disabled} run={run} updated={updated} />}
      </>}
    </div>
  </details>;
}

function PersonForm({ person, disabled, mutate }: { person?: WorkforcePerson; disabled: boolean; mutate: Mutate }) {
  const current = person?.employee;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const data = new FormData(event.currentTarget);
    const name = value(data, "name"), sector = value(data, "sector"), role = value(data, "role"), activeFrom = value(data, "activeFrom");
    const registration = current?.registration ?? value(data, "registration");
    if (!name || !registration) return;
    if (current) void mutate({ action: "UPDATE_PERSON", registration, name, sector, role, ...(activeFrom ? { activeFrom } : {}) });
    else if (activeFrom) void mutate({ action: "CREATE_PERSON", registration, name, sector, role, activeFrom });
  }
  return <form onSubmit={submit} className={styles.stackSmall}>
    {!current && <p className={styles.muted}>O cadastro manual não atribui jornada automática.</p>}
    <div className={styles.formGrid}>
      <Field label="Matrícula" hint={current ? "A matrícula identifica o colaborador e não pode ser alterada." : undefined}>
        {id => <input id={id} name="registration" className={controlClass} required inputMode="numeric" pattern="[0-9]{1,60}" maxLength={60} readOnly={Boolean(current)} defaultValue={current?.registration ?? ""} disabled={disabled} />}
      </Field>
      <Field label="Nome">{id => <input id={id} name="name" className={controlClass} required maxLength={160} defaultValue={current?.name ?? ""} disabled={disabled} />}</Field>
      <Field label="Setor">{id => <input id={id} name="sector" className={controlClass} maxLength={160} defaultValue={current?.sector ?? ""} disabled={disabled} />}</Field>
      <Field label="Cargo">{id => <input id={id} name="role" className={controlClass} maxLength={160} defaultValue={current?.role ?? ""} disabled={disabled} />}</Field>
      <Field label="Data de admissão">
        {id => <input id={id} name="activeFrom" className={controlClass} type="date" required={!current} defaultValue={current?.activeFrom ?? ""} disabled={disabled} />}
      </Field>
    </div>
    <button type="submit" className={primaryClass} disabled={disabled}>{current ? "Salvar cadastro" : "Cadastrar colaborador"}</button>
  </form>;
}

function PersonOperations({ person, absences, disabled, mutate }: {
  person: WorkforcePerson; absences: WorkforceAbsence[]; disabled: boolean; mutate: Mutate;
}) {
  const { registration, name } = person.employee;
  const [editing, setEditing] = useState<WorkforceAbsence>();
  const [removal, setRemoval] = useState<WorkforceAbsence>();
  const [dismiss, setDismiss] = useState(false);
  return <div className={styles.stackSmall}>
    <details>
      <summary className={styles.disclosureTrigger}>Editar cadastro de {name}</summary>
      <PersonForm person={person} disabled={disabled} mutate={mutate} />
    </details>
    <details>
      <summary className={styles.disclosureTrigger}>Afastamentos de {name} ({absences.length})</summary>
      <div className={styles.stackSmall}>
        {absences.length ? <ul className={styles.stackSmall}>{[...absences].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(absence =>
          <li className={styles.feedback} key={absence.startDate}>
            <p><strong>{labelDate(absence.startDate)}</strong> {absence.endDate ? `a ${labelDate(absence.endDate)}` : "· Retorno indefinido"} · {absence.source === "MANUAL" ? "Manual" : "Importado"}</p>
            {!absence.endDate && <ReturnForm absence={absence} disabled={disabled} mutate={mutate} />}
            <div className={styles.actions}>
              <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setEditing(absence); setRemoval(undefined); }}>Editar intervalo</button>
              <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setRemoval(absence); setEditing(undefined); }}>Excluir intervalo</button>
            </div>
            {removal?.startDate === absence.startDate && <div className={styles.actions}>
              <p>Excluir este afastamento de {name}, iniciado em {labelDate(absence.startDate)}?</p>
              <button type="button" className={buttonClass} disabled={disabled} onClick={() => setRemoval(undefined)}>Cancelar exclusão</button>
              <button type="button" className={primaryClass} disabled={disabled} onClick={async () => {
                if (await mutate({ action: "REMOVE_ABSENCE", registration, startDate: absence.startDate })) setRemoval(undefined);
              }}>Confirmar exclusão</button>
            </div>}
          </li>,
        )}</ul> : <p className={styles.muted}>Nenhum afastamento registrado.</p>}
        <AbsenceForm key={editing?.startDate ?? "new"} registration={registration} absence={editing} disabled={disabled} mutate={mutate} onCancel={() => setEditing(undefined)} />
      </div>
    </details>
    <details>
      <summary className={styles.disclosureTrigger}>Registrar desligamento</summary>
      {person.dismissedFrom ? <p>Primeiro dia sem vínculo: {labelDate(person.dismissedFrom)}.</p> : <form className={styles.stackSmall} onSubmit={event => {
        event.preventDefault();
        const dismissedFrom = value(new FormData(event.currentTarget), "dismissedFrom");
        if (!disabled && dismiss && dismissedFrom) void mutate({ action: "DISMISS_PERSON", registration, dismissedFrom });
      }}>
        <Field label="Primeiro dia sem vínculo" hint="O histórico e as publicações anteriores ficam preservados.">
          {id => <input id={id} name="dismissedFrom" className={controlClass} type="date" min={person.employee.activeFrom || undefined} required disabled={disabled} />}
        </Field>
        <Check label={`Confirmo o desligamento de ${name} na data informada.`} checked={dismiss} onChange={setDismiss} disabled={disabled} />
        <button type="submit" className={primaryClass} disabled={disabled || !dismiss}>Confirmar desligamento</button>
      </form>}
    </details>
  </div>;
}

function AbsenceForm({ registration, absence, disabled, mutate, onCancel }: {
  registration: string; absence?: WorkforceAbsence; disabled: boolean; mutate: Mutate; onCancel: () => void;
}) {
  const [start, setStart] = useState(absence?.startDate ?? "");
  const [open, setOpen] = useState(absence?.endDate === null);
  const [end, setEnd] = useState(absence?.endDate ?? "");
  const wrongEnd = Boolean(!open && end && start && end < start);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !start || !open && (!end || wrongEnd)) return;
    if (await mutate({
      action: "SET_ABSENCE", registration, startDate: start, endDate: open ? null : end,
      ...(absence ? { previousStartDate: absence.startDate } : {}),
    })) {
      setStart(""); setEnd(""); setOpen(false); onCancel();
    }
  }
  return <form className={styles.stackSmall} onSubmit={submit}>
    <h3 className={styles.sectionTitle}>{absence ? `Editar afastamento de ${labelDate(absence.startDate)}` : "Novo afastamento"}</h3>
    <div className={styles.formGrid}>
      <Field label="Início do afastamento">{id => <input id={id} className={controlClass} required type="date" value={start} onChange={event => setStart(event.target.value)} disabled={disabled} />}</Field>
      {!open && <Field label="Último dia de afastamento" error={wrongEnd ? "Informe uma data igual ou posterior ao início." : undefined}>
        {id => <input id={id} className={controlClass} required min={start || undefined} type="date" value={end} onChange={event => setEnd(event.target.value)} disabled={disabled} />}
      </Field>}
    </div>
    <Check label="Sem data de retorno" checked={open} onChange={setOpen} disabled={disabled} />
    <div className={styles.actions}>
      <button type="submit" className={primaryClass} disabled={disabled || !start || !open && (!end || wrongEnd)}>Salvar afastamento</button>
      {absence && <button type="button" className={buttonClass} disabled={disabled} onClick={onCancel}>Cancelar edição</button>}
    </div>
  </form>;
}

function ReturnForm({ absence, disabled, mutate }: { absence: WorkforceAbsence; disabled: boolean; mutate: Mutate }) {
  return <form className={styles.stackSmall} onSubmit={event => {
    event.preventDefault();
    const returnDate = value(new FormData(event.currentTarget), "returnDate");
    if (!disabled && returnDate) void mutate({ action: "SET_RETURN_DATE", registration: absence.registration, startDate: absence.startDate, returnDate });
  }}>
    <Field label={`Data de retorno · afastamento de ${labelDate(absence.startDate)}`} hint="Informe o primeiro dia disponível para trabalhar.">
      {id => <input id={id} name="returnDate" type="date" className={controlClass} min={absence.startDate} required disabled={disabled} />}
    </Field>
    <button type="submit" className={buttonClass} disabled={disabled}>Registrar retorno</button>
  </form>;
}

function GlobalImport({ disabled, run, updated }: { disabled: boolean; run: Run; updated: (result: { revision: number; changed: boolean }) => Promise<void> }) {
  const [file, setFile] = useState<File>();
  const [purpose, setPurpose] = useState<WorkforceImportPurpose>("EMPLOYEES");
  const [review, setReview] = useState<ImportReview>();
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const fileId = useId();
  const submitted = Object.entries(corrections).flatMap(([line, registration]) => registration.trim() ? [{ line: Number(line), registration: registration.trim() }] : []);
  const currentReview = !needsReview && review?.file === file && review?.purpose === purpose
    && JSON.stringify(review?.corrections) === JSON.stringify(submitted) ? review : undefined;
  const canApply = Boolean(currentReview?.preview.canApply && currentReview.preview.changed && !currentReview.preview.missingRegistrations?.some(row => !row.resolved));

  function reset() { setReview(undefined); setCorrections({}); setConfirmed(false); setNeedsReview(false); }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !file) return;
    setConfirmed(false);
    setNeedsReview(true);
    const result = await run(signal => previewWorkforceImport(file, purpose, submitted, signal));
    if (result) {
      setReview({ file, purpose, corrections: submitted, preview: result });
      setNeedsReview(false);
    }
  }

  async function apply() {
    if (disabled || !confirmed || !canApply || !currentReview) return;
    const { file, purpose, corrections, preview } = currentReview;
    setConfirmed(false);
    setReview(undefined);
    const result = await run(signal => applyWorkforceImport(file, purpose, corrections, preview, signal));
    if (result) await updated(result);
  }

  return <details>
    <summary className={styles.disclosureTrigger}>Importação administrativa da base</summary>
    <p className={styles.muted}>A importação é global e pode alterar as filiais presentes no arquivo. Só a confirmação grava a prévia conferida.</p>
    <form className={styles.stackSmall} onSubmit={preview}>
      <div className={styles.formGrid}>
        <Field label="Tipo de importação">{id => <select id={id} className={controlClass} value={purpose} disabled={disabled} onChange={event => {
          setPurpose(event.target.value === "ABSENCES" ? "ABSENCES" : "EMPLOYEES");
          setFile(undefined); reset();
        }}>
          <option value="EMPLOYEES">Equipe</option><option value="ABSENCES">Afastamentos</option>
        </select>}</Field>
        <Field label="Arquivo da base de pessoal" hint={purpose === "ABSENCES" ? "Relatório FPHI105 em CSV, até 512 KB." : "Relatório FPRE136 em CSV, até 512 KB."}>{id => <input key={`${fileId}:${purpose}`} id={id} type="file" className={controlClass} accept=".csv" required disabled={disabled} onChange={event => {
          setFile(event.target.files?.[0]); reset();
        }} />}</Field>
      </div>
      {review && <div className={styles.feedback}>
        <h3 className={styles.sectionTitle}>Prévia da importação</h3>
        <p>Revisão {review.preview.revision} · {review.preview.rowCount} registro(s){review.preview.openRowCount !== undefined ? ` · ${review.preview.openRowCount} sem retorno` : ""}.</p>
        {review.preview.branchCodes?.length ? <p>Filiais no arquivo: {review.preview.branchCodes.join(", ")}.</p> : null}
        {review.preview.missingRegistrations?.length ? <div className={styles.formGrid}>{review.preview.missingRegistrations.map(row =>
          <Field key={row.line} label={`Matrícula da linha ${row.line}${row.name ? ` · ${row.name}` : ""}`} hint={row.branchCode ? `Filial ${row.branchCode}.` : undefined}>
            {id => <input id={id} className={controlClass} inputMode="numeric" pattern="[0-9]{1,60}" maxLength={60} value={corrections[row.line] ?? ""} disabled={disabled} onChange={event => {
              const registration = event.target.value;
              setCorrections(previous => ({ ...previous, [row.line]: registration })); setConfirmed(false);
            }} />}
          </Field>,
        )}</div> : null}
        {!currentReview && <p role="status">Os dados mudaram. Confira uma nova prévia antes de aplicar.</p>}
        {currentReview && !review.preview.canApply && <p>Preencha os dados pendentes e confira o arquivo novamente.</p>}
        {currentReview && review.preview.canApply && !review.preview.changed && <p>Nenhuma alteração encontrada.</p>}
      </div>}
      <div className={styles.actions}><button type="submit" className={buttonClass} disabled={disabled || !file}>Conferir arquivo</button></div>
    </form>
    {canApply && <div className={styles.stackSmall}>
      <Check label="Conferi a prévia e confirmo as mudanças na base de pessoal." checked={confirmed} onChange={setConfirmed} disabled={disabled} />
      <div className={styles.actions}><button type="button" className={primaryClass} disabled={disabled || !confirmed} onClick={() => void apply()}>Confirmar importação</button></div>
    </div>}
  </details>;
}
