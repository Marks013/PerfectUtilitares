"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./escalas.module.css";
import type { EscalaAssignment, EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, primaryClass } from "./controls";
import { applyRosterChanges, inspectRosterChanges, swapRosterDays, type RosterDay } from "./roster-model";
import { displayDate, errorMessage } from "./workspace-model";

type Preview = { source: EscalaInput; input: EscalaInput; impact: ReturnType<typeof inspectRosterChanges> };

function Impact({ preview, confirm, cancel }: { preview: Preview; confirm: () => void; cancel: () => void }) {
  const { impact } = preview;
  const issues = [...impact.newErrors, ...impact.coverageIssues.filter((issue) => issue.severity !== "ERROR")];
  return <section className={styles.editorImpact} aria-label="Impacto da alteração">
    <p className="font-semibold">Prévia: {impact.changedDays} dia(s) alterado(s)</p>
    <p className="text-sm">Descansos e jornada dos colaboradores afetados foram conferidos, incluindo as fronteiras. A cobertura foi recalculada nos setores e dias afetados.</p>
    <p className="text-sm">{impact.newErrors.length ? `${impact.newErrors.length} novo(s) conflito(s). Você pode manter a simulação em rascunho, mas precisa resolvê-los antes de publicar.` : "Nenhum novo conflito obrigatório foi identificado nesta alteração."}</p>
    {issues.length > 0 && <ul className={styles.editorIssues}>
      {issues.map((issue) => <li key={`${issue.code}:${issue.employeeId}:${issue.date}:${issue.message}`}>
        {issue.date ? `${displayDate(issue.date)} · ` : ""}{issue.message}
      </li>)}
    </ul>}
    <div className={styles.actions}>
      <button type="button" className={primaryClass} onClick={confirm}>{impact.newErrors.length ? "Aplicar com conflitos ao rascunho" : "Confirmar alteração"}</button>
      <button type="button" className={buttonClass} onClick={cancel}>Voltar à edição</button>
    </div>
  </section>;
}

export function CellEditor({ employee, date, assignment, input, canUnlock, onApply, onCancel }: {
  employee: EscalaEmployee; date: string; assignment?: EscalaAssignment; input: EscalaInput; canUnlock: boolean;
  onApply: (assignment: EscalaAssignment) => void; onCancel: () => void;
}) {
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => { editor.current?.scrollIntoView?.({ block: "nearest" }); editor.current?.focus(); }, []);
  const untimed = employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING";
  const [kind, setKind] = useState<EscalaAssignment["kind"]>(assignment?.kind ?? (untimed ? "DUTY" : "WORK"));
  const [shiftId, setShiftId] = useState(assignment?.shiftId ?? employee.shiftIds[0] ?? "");
  const [locked, setLocked] = useState(true);
  const [preview, setPreview] = useState<(Preview & { assignment: EscalaAssignment }) | null>(null);
  const [error, setError] = useState("");
  const wasLocked = Boolean(assignment?.locked);
  const current = preview?.source === input ? preview : null;
  return <form ref={editor} id="escala-day-editor" tabIndex={-1} className={styles.editor} onSubmit={(event) => {
    event.preventDefault();
    setError("");
    try {
      const next: EscalaAssignment = { employeeId: employee.id, date, kind, ...(kind === "WORK" ? { shiftId } : {}), locked };
      const proposed = applyRosterChanges(input, [next], canUnlock);
      setPreview({ source: input, input: proposed, assignment: next, impact: inspectRosterChanges(input, proposed) });
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <h3 className="font-semibold">{employee.name} · {displayDate(date)}</h3>
    {employee.sourceSchedule && <p className={styles.muted}>Horário importado: {employee.sourceSchedule.weekday}. Referência {employee.sourceSchedule.code} · {employee.sourceSchedule.description}.</p>}
    {employee.scheduleMode === "MISSING" && <p className="text-sm">Horário não informado na importação. Presença e folgas podem ser simuladas; jornada e cobertura por horário não estão verificadas. Isso não confirma dispensa de controle de jornada.</p>}
    {wasLocked && <p className="text-sm">Esta decisão está bloqueada. Um aprovador pode desmarcar o bloqueio e salvar a revisão. Só depois poderá alterar a jornada.</p>}
    <fieldset disabled={Boolean(current)} className="space-y-3">
      <div className={styles.formGrid}>
        <Field label="Situação do dia">{(id) => <select id={id} disabled={wasLocked} value={kind} className={controlClass} onChange={(event) => setKind(event.target.value as EscalaAssignment["kind"])}>
          {untimed ? <option value="DUTY">{employee.scheduleMode === "UNTIMED" ? "ENC — Não subordinado a horário" : "NP — Horário não processado (presença diária)"}</option> : <option value="WORK">Trabalho</option>}
          <option value="OFF">Folga</option><option value="ABSENCE">AF — Afastamento</option>
        </select>}</Field>
        {kind === "WORK" && !untimed && <Field label="Turno autorizado">{(id) => <select id={id} required disabled={wasLocked} value={shiftId} className={controlClass} onChange={(event) => setShiftId(event.target.value)}>
          <option value="">Selecione</option>
          {input.shifts.filter((shift) => employee.shiftIds.includes(shift.id)).map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
        </select>}</Field>}
      </div>
      <Check label="Preservar esta decisão nas próximas gerações" checked={locked} disabled={wasLocked && !canUnlock} onChange={setLocked} />
      <button type="submit" className={primaryClass} disabled={wasLocked && (!canUnlock || locked)}>Conferir alteração</button>
    </fieldset>
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {current && <Impact preview={current} confirm={() => onApply(current.assignment)} cancel={() => setPreview(null)} />}
    <button type="button" className={buttonClass} onClick={onCancel}>Cancelar edição</button>
  </form>;
}

export function SwapEditor({ input, first, dates, onApply }: { input: EscalaInput; first: RosterDay; dates: string[]; onApply: (next: EscalaInput) => void }) {
  const [employeeId, setEmployeeId] = useState(input.employees.find((person) => person.id !== first.employeeId && person.planningEnabled !== false)?.id ?? first.employeeId);
  const [date, setDate] = useState(first.date);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const current = preview?.source === input ? preview : null;
  return <details className={styles.editorImpact}>
    <summary className={styles.disclosureTrigger}>Trocar este dia com outro colaborador ou outra data</summary>
    <p className="text-sm">Troque turnos ou folgas. A operação preserva os dois dias juntos e confere se o turno é permitido para cada pessoa.</p>
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setError("");
      try { const next = swapRosterDays(input, first, { employeeId, date }); setPreview({ source: input, input: next, impact: inspectRosterChanges(input, next) }); }
      catch (cause) { setPreview(null); setError(errorMessage(cause)); }
    }}>
      <fieldset disabled={Boolean(current)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Colaborador para a troca">{(id) => <select id={id} value={employeeId} className={controlClass} onChange={(event) => setEmployeeId(event.target.value)}>
          {input.employees.filter((person) => person.planningEnabled !== false).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.registration} · {person.sector}</option>)}
        </select>}</Field>
        <Field label="Data para a troca">{(id) => <select id={id} value={date} className={controlClass} onChange={(event) => setDate(event.target.value)}>
          {dates.map((day) => <option key={day} value={day}>{displayDate(day)}</option>)}
        </select>}</Field>
        <button type="submit" className={buttonClass}>Conferir troca</button>
      </fieldset>
    </form>
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {current && <Impact preview={current} confirm={() => onApply(current.input)} cancel={() => setPreview(null)} />}
  </details>;
}
