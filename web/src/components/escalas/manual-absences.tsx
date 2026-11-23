"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { absencePeriods } from "./absence-import";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import styles from "./escalas.module.css";
import type { AbsenceCommand } from "./workspace-team-actions";
import { displayDate } from "./workspace-model";

type Range = Omit<AbsenceCommand, "action">;

export function ManualAbsences({ workspace, administrator, disabled, changeAbsence }: {
  workspace: EscalaWorkspace;
  administrator: boolean;
  disabled: boolean;
  changeAbsence: (command: AbsenceCommand) => Promise<boolean>;
}) {
  const [employeeId, selectEmployee] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [confirmation, confirmRemoval] = useState<Range | null>(null);
  const [removing, setRemoving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmationTitle = useId();
  const confirmationDescription = useId();
  const { input } = workspace;
  const days = visibleDates(input);
  const min = days[0], max = days.at(-1);
  const people = [...input.employees].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.registration.localeCompare(b.registration));
  const person = people.find(entry => entry.id === employeeId);
  const first = person && min && person.activeFrom > min ? person.activeFrom : min;
  const last = person?.activeUntil && max && person.activeUntil < max ? person.activeUntil : max;
  const canAdd = Boolean(first && last && first <= last);
  const validDates = Boolean(first && last && startDate && endDate && startDate >= first && startDate <= endDate && endDate <= last);
  const groups = new Map<string, { range: Range; source: string; removable: boolean }[]>();
  const visible = new Set(days);
  const absences = input.assignments.filter(item => item.kind === "ABSENCE" && visible.has(item.date));
  for (const { source, assignments, removable } of [
    { source: "Manual", assignments: absences.filter(item => item.absenceSource === "MANUAL" && !item.locked), removable: true },
    { source: "Importado ou legado", assignments: absences.filter(item => item.absenceSource !== "MANUAL" && !item.locked), removable: administrator },
    { source: "Manual · bloqueado", assignments: absences.filter(item => item.absenceSource === "MANUAL" && item.locked), removable: false },
    { source: "Importado ou legado · bloqueado", assignments: absences.filter(item => item.absenceSource !== "MANUAL" && item.locked), removable: false },
  ]) {
    for (const range of absencePeriods(assignments)) {
      const entries = groups.get(range.employeeId) ?? [];
      entries.push({ range, source, removable });
      groups.set(range.employeeId, entries);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || confirmation) return;
    setSubmitted(true);
    if (person && validDates && await changeAbsence({ action: "ADD_ABSENCE", employeeId, startDate, endDate })) {
      setStart(""); setEnd(""); setSubmitted(false);
    }
  }

  async function remove() {
    if (!confirmation || disabled || removing) return;
    setRemoving(true);
    try {
      await changeAbsence({ action: "REMOVE_ABSENCE", ...confirmation });
      dialog.current?.close();
    } finally {
      setRemoving(false);
    }
  }

  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Afastamentos do planejamento</summary>
    <div className={styles.stackSmall}>
      <p className={styles.muted}>Lance por colaborador e informe o primeiro e o último dia. Períodos com dias bloqueados, feriados fechados ou ajustes manuais não são salvos. A próxima geração considera os afastamentos salvos, sem publicar a escala.</p>
      <p className={styles.muted}>{administrator
        ? "Para corrigir um período, exclua o registro incorreto e lance o novo. A importação confirmada substitui os afastamentos dentro do período informado."
        : "Você pode excluir os lançamentos manuais desta filial. Registros importados ou legados são administrados separadamente."}</p>
      {disabled && <p role="status" className={styles.muted}>Conclua a operação ou resolva as alterações pendentes para editar afastamentos.</p>}
      <form noValidate className={styles.stackSmall} onSubmit={add}>
        <div className={styles.formGrid}>
          <Field label="Colaborador" error={submitted && !person ? "Selecione um colaborador." : undefined}>
            {(id) => <select id={id} required className={controlClass} disabled={disabled || Boolean(confirmation)} value={employeeId} onChange={event => selectEmployee(event.target.value)}>
              <option value="">Selecione</option>
              {people.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.registration}</option>)}
            </select>}
          </Field>
          <Field label="Início do afastamento" error={submitted && (!startDate || Boolean(first && startDate < first || last && startDate > last)) ? "Escolha uma data no período ativo deste planejamento." : undefined}>
            {(id) => <input id={id} type="date" required min={first} max={last} value={startDate} className={controlClass} disabled={disabled || !canAdd || Boolean(confirmation)} onChange={event => setStart(event.target.value)} />}
          </Field>
          <Field label="Fim do afastamento" error={submitted && (!endDate || endDate < startDate || Boolean(last && endDate > last)) ? "Informe uma data igual ou posterior ao início, dentro do período." : undefined}>
            {(id) => <input id={id} type="date" required min={startDate || first} max={last} value={endDate} className={controlClass} disabled={disabled || !canAdd || Boolean(confirmation)} onChange={event => setEnd(event.target.value)} />}
          </Field>
        </div>
        {person && !canAdd && <p className={styles.muted}>Este colaborador não tem dias ativos no período selecionado.</p>}
        <div className={styles.actions}><button type="submit" className={primaryClass} disabled={disabled || !canAdd || !people.length || Boolean(confirmation)}>Salvar afastamento</button></div>
      </form>
      <div>
        <h3 className={styles.sectionTitle}>Afastamentos registrados</h3>
        {!groups.size && <p className={styles.muted}>Nenhum afastamento registrado no período.</p>}
        {groups.size > 0 && <ul className={styles.stackSmall}>{people.filter(entry => groups.has(entry.id)).map(entry => <li key={entry.id}>
          <strong>{entry.name} · {entry.registration}</strong>
          <ul className={styles.stackSmall}>{groups.get(entry.id)?.sort((a, b) => a.range.startDate.localeCompare(b.range.startDate)).map(({ range, source, removable }) => {
            const label = `${displayDate(range.startDate)} a ${displayDate(range.endDate)}`;
            return <li key={`${range.startDate}:${source}`} className={styles.actions}>
              <span>{label} · {source}</span>
              {removable && <button type="button" className={buttonClass} disabled={disabled} onClick={() => { confirmRemoval(range); dialog.current?.showModal(); }} aria-label={`Excluir afastamento de ${entry.name}, ${label}`}>Excluir</button>}
            </li>;
          })}</ul>
        </li>)}</ul>}
      </div>
      <dialog ref={dialog} onClose={() => confirmRemoval(null)} onCancel={event => { if (removing) event.preventDefault(); }} aria-labelledby={confirmationTitle} aria-describedby={confirmationDescription}
        className="m-auto w-[calc(100%_-_2rem)] max-w-lg app-radius-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-6 text-[color:var(--app-fg)] backdrop:bg-black/50">
        <h3 id={confirmationTitle} className="text-lg font-bold">Excluir afastamento?</h3>
        <p id={confirmationDescription} className="my-4 text-sm">{confirmation && <><strong>{people.find(entry => entry.id === confirmation.employeeId)?.name}</strong><br />{displayDate(confirmation.startDate)} a {displayDate(confirmation.endDate)}.<br />Para preencher os dias liberados, gere uma proposta em Só folgas ou Folgas e horários.</>}</p>
        <div className={styles.actions}>
          <button type="button" className={buttonClass} disabled={removing} onClick={() => dialog.current?.close()}>Manter afastamento</button>
          <button type="button" className={`${buttonClass} border-[color:var(--app-coral)] text-[color:var(--app-coral)]`} disabled={disabled || removing || !confirmation} onClick={() => void remove()}>Confirmar exclusão</button>
        </div>
      </dialog>
    </div>
  </details>;
}
