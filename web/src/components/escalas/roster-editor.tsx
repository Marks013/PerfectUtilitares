"use client";

import { isEscalaPlanningParticipant } from "@/lib/escalas/eligibility";
import { holidayRestDates, manualHolidayRestMessage } from "@/lib/escalas/holiday-rest";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./escalas.module.css";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, primaryClass } from "./controls";
import { applyRosterChanges, canEditBranchRosterDay, inspectRosterChanges, rosterShiftOptions, swapRosterDays, type RosterDay } from "./roster-model";
import { clock, displayDate, errorMessage } from "./workspace-model";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";

type Preview = { source: EscalaInput; input: EscalaInput; impact: ReturnType<typeof inspectRosterChanges> };

export function canChangeRosterDay(assignment: EscalaAssignment | undefined, administrative: boolean, canUnlock: boolean) {
  if (!assignment) return true;
  if (assignment.kind === "HOLIDAY") return false;
  if (!administrative) return canEditBranchRosterDay(assignment);
  return assignment.locked !== true || canUnlock && assignment.kind !== "ABSENCE";
}

function usePreviewTrigger(showingPreview: boolean) {
  const trigger = useRef<HTMLButtonElement>(null);
  const returning = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!showingPreview && returning.current) {
      returning.current.focus();
      returning.current = null;
    }
  }, [showingPreview]);
  return { trigger, returnFocus: (target = trigger.current) => { returning.current = target; } };
}

function Impact({ preview, summary, confirm, cancel }: { preview: Preview; summary: string; confirm: () => void; cancel: () => void }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.focus({ preventScroll: true });
    section.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const access = useEscalaClientAccess();
  const { impact } = preview;
  const analytics = canDisplayEscalaAction(access, "report.analytics", preview.source.branchCode);
  const newErrors = analytics ? impact.newErrors : impact.newErrors.filter((issue) =>
    issue.code !== "COVERAGE_DEFICIT" && issue.code !== "ESTIMATED_COVERAGE_GAP");
  const issues = [...newErrors, ...(analytics ? impact.coverageIssues.filter((issue) => issue.severity !== "ERROR") : [])];
  return <section ref={section} tabIndex={-1} className={`${styles.editorImpact} ${styles.feedbackFocus}`} aria-label="Impacto da alteração">
    <p className="font-semibold">{summary}</p>
    <p className="text-sm">{newErrors.length ? `${newErrors.length} ${newErrors.length === 1 ? "novo conflito" : "novos conflitos"}. A alteração pode ficar no rascunho e precisa de revisão antes de publicar.` : "Nenhum novo conflito nas regras verificadas."}</p>
    {issues.length > 0 && <ul className={styles.editorIssues}>
      {issues.map((issue) => <li key={`${issue.code}:${issue.employeeId}:${issue.date}:${issue.message}`}>
        {issue.date ? `${displayDate(issue.date)} · ` : ""}{issue.message}
      </li>)}
    </ul>}
    <div className={styles.actions}>
      <button type="button" className={primaryClass} onClick={confirm}>{newErrors.length ? "Aplicar com conflitos ao rascunho" : "Confirmar alteração"}</button>
      <button type="button" className={buttonClass} onClick={cancel}>Voltar à edição</button>
    </div>
  </section>;
}

function shiftHours(shift: EscalaShift) {
  return shift.segments.map(segment => {
    const note = segment.kind === "BREAK" ? " (intervalo)" : segment.kind === "PAID_BREAK" ? " (pausa remunerada)" : "";
    return `${clock(segment.start)}–${clock(segment.end)}${note}`;
  }).join(" / ");
}

function dayLabel(day: EscalaAssignment | undefined, shifts: EscalaInput["shifts"]) {
  switch (day?.kind) {
    case "OFF": return "Folga";
    case "ABSENCE": return "Afastamento";
    case "HOLIDAY": return "Feriado";
    case "DUTY": return "Presença sem horário";
    case "WORK": {
      const shift = shifts.find(item => item.id === day.shiftId);
      return shift ? `Trabalho · ${shiftHours(shift)}` : "Trabalho";
    }
    default: return "Dia sem definição";
  }
}

export function CellEditor({ employee, date, assignment, input, canUnlock, onApply, onCancel }: {
  employee: EscalaEmployee; date: string; assignment?: EscalaAssignment; input: EscalaInput; canUnlock: boolean;
  onApply: (assignment: EscalaAssignment) => void; onCancel: () => void;
}) {
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => { editor.current?.scrollIntoView?.({ block: "nearest" }); editor.current?.focus(); }, []);
  const access = useEscalaClientAccess();
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const canApply = canDisplayEscalaAction(access, "schedule.apply", input.branchCode)
    && canDisplayEscalaAction(access, "workspace.save", input.branchCode);
  const mayUnlock = administrative && canUnlock && assignment?.kind !== "ABSENCE" && assignment?.kind !== "HOLIDAY";
  const protectedDay = assignment?.kind === "HOLIDAY" || (!administrative && assignment?.kind === "ABSENCE");
  const untimed = employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING";
  const workKind = untimed ? "DUTY" : "WORK";
  const [kind, setKind] = useState<EscalaAssignment["kind"]>(assignment?.kind ?? workKind);
  const shifts = rosterShiftOptions(input.shifts, employee, date);
  const [shiftId, setShiftId] = useState(() => {
    if (assignment?.locked) return assignment.shiftId ?? "";
    const current = shifts.find(shift => shift.id === assignment?.shiftId);
    return current?.id ?? shifts.find(shift => shift.id === employee.shiftIds[0])?.id ?? shifts[0]?.id ?? "";
  });
  const [locked, setLocked] = useState(true);
  const [preview, setPreview] = useState<(Preview & { assignment: EscalaAssignment }) | null>(null);
  const [error, setError] = useState("");
  const wasLocked = assignment?.locked === true;
  const holiday = holidayRestDates(input).has(date);
  const branchLocked = !administrative && assignment !== undefined && !canEditBranchRosterDay(assignment);
  const canChange = canApply && canChangeRosterDay(assignment, administrative, canUnlock);
  const current = canChange && preview?.source === input
    && (administrative || preview.assignment.locked === false) ? preview : null;
  const { trigger, returnFocus } = usePreviewTrigger(Boolean(current));
  const offTrigger = useRef<HTMLButtonElement>(null);
  function previewDay(nextKind: EscalaAssignment["kind"]) {
    setError("");
    try {
      if (!canChange || current) return;
      if (wasLocked && (!mayUnlock || locked)) throw new Error("Desbloqueie e salve este dia antes de alterar a jornada.");
      if (!administrative && nextKind === "ABSENCE") throw new Error("Peça ao administrador para ajustar afastamentos.");
      const next: EscalaAssignment = {
        employeeId: employee.id, date, kind: nextKind,
        ...(nextKind === "WORK" ? { shiftId } : {}),
        locked: administrative ? locked : false,
      };
      const proposed = applyRosterChanges(input, [next], mayUnlock);
      setPreview({ source: input, input: proposed, assignment: next, impact: inspectRosterChanges(input, proposed) });
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <form ref={editor} id="escala-day-editor" tabIndex={-1} aria-labelledby="escala-day-editor-title" className={`${styles.editor} ${styles.feedbackFocus}`} onSubmit={event => {
    event.preventDefault(); previewDay(kind);
  }}>
    <h3 id="escala-day-editor-title" className="font-semibold">{employee.name} · {displayDate(date)}</h3>
    <p className={styles.muted}><strong>Na escala:</strong> {dayLabel(assignment, input.shifts)}. O ajuste vale só para {displayDate(date)}.</p>
    {employee.scheduleMode === "MISSING" && <p className={styles.muted}>A presença sem horário definido não entra na contagem por hora.</p>}
    {wasLocked && <p className="text-sm">{canChange ? "Desmarque a proteção e confirme o desbloqueio antes de alterar este dia." : "Dia bloqueado. O administrador pode conferir a proteção."}</p>}
    {branchLocked && !protectedDay && !wasLocked && <p className={styles.muted}>Este dia registrado não está liberado para edição pela filial. Consulte o administrador.</p>}
    {protectedDay && <p className={styles.muted}>Afastamentos e feriados registrados são preservados. Consulte o administrador para corrigir este dia.</p>}
    {holiday && canChange && <p className={styles.muted}>{manualHolidayRestMessage}</p>}
    {canChange && <fieldset disabled={Boolean(current)} className={styles.stackSmall}>
      {!wasLocked && <div className={styles.actions}>
        {!holiday && <button ref={offTrigger} type="button" className={buttonClass} onClick={() => { setKind("OFF"); previewDay("OFF"); }}>Marcar folga</button>}
        <button type="button" className={`${buttonClass} ${styles.areaTab}`} aria-pressed={kind === workKind} onClick={() => { setError(""); setKind(workKind); }}>{untimed ? "Marcar presença" : "Definir horário"}</button>
      </div>}
      {!wasLocked && kind === "WORK" && !untimed && <Field label="Horário de trabalho neste dia">{(id) => <select id={id} required value={shiftId} className={controlClass} onChange={(event) => setShiftId(event.target.value)}>
          <option value="">Escolha um turno permitido</option>
          {shifts.map(shift => <option key={shift.id} value={shift.id}>{shiftHours(shift)} · {shift.name}</option>)}
      </select>}</Field>}
      {administrative && (wasLocked
        ? <Check label="Preservar esta decisão nas próximas gerações" checked={locked} onChange={setLocked} />
        : <details className={styles.disclosure}>
          <summary className={styles.disclosureTrigger}>Opções de edição</summary>
          <Check label="Preservar esta decisão nas próximas gerações" checked={locked} onChange={setLocked} />
          <button type="button" className={`${buttonClass} ${styles.areaTab}`} aria-pressed={kind === "ABSENCE"} onClick={() => { setError(""); setKind("ABSENCE"); }}>Marcar afastamento</button>
        </details>)}
      {(wasLocked || kind !== "OFF") && <div className={styles.actions}>
        <button ref={trigger} type="submit" className={primaryClass} disabled={wasLocked && locked}>Conferir alteração</button>
      </div>}
    </fieldset>}
    {employee.sourceSchedule && <details className={styles.disclosure}>
      <summary className={styles.disclosureTrigger}>Horário importado</summary>
      <p className={styles.muted}>{employee.sourceSchedule.weekday}. Referência {employee.sourceSchedule.code} · {employee.sourceSchedule.description}.</p>
    </details>}
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {current && <Impact preview={current} summary={`${displayDate(date)} · ${wasLocked ? "Desbloquear dia" : dayLabel(current.assignment, input.shifts)}`}
      confirm={() => onApply(current.assignment)} cancel={() => { returnFocus(!wasLocked && current.assignment.kind === "OFF" ? offTrigger.current : undefined); setPreview(null); }} />}
    <button type="button" className={buttonClass} onClick={onCancel}>{canChange ? "Cancelar edição" : "Fechar consulta"}</button>
  </form>;
}

export function SwapEditor({ input, first, dates, onApply }: { input: EscalaInput; first: RosterDay; dates: string[]; onApply: (next: EscalaInput) => void }) {
  const access = useEscalaClientAccess();
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const canApply = canDisplayEscalaAction(access, "schedule.apply", input.branchCode)
    && canDisplayEscalaAction(access, "workspace.save", input.branchCode);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<(Preview & { administrative: boolean; summary: string }) | null>(null);
  const [error, setError] = useState("");
  const current = canApply && preview?.source === input && preview.administrative === administrative ? preview : null;
  const { trigger, returnFocus } = usePreviewTrigger(Boolean(current));
  const targetsByEmployee = useMemo(() => {
    const visible = new Set(dates);
    const people = new Map(input.employees.filter(isEscalaPlanningParticipant).map(person => [person.id, person]));
    const targets = new Map<string, EscalaAssignment[]>();
    for (const day of input.assignments) {
      const person = people.get(day.employeeId);
      if (!person || !visible.has(day.date) || day.kind === "ABSENCE" || !canChangeRosterDay(day, administrative, false)) continue;
      if (day.employeeId === first.employeeId && day.date === first.date) continue;
      if (person.activeFrom && day.date < person.activeFrom || person.activeUntil && day.date > person.activeUntil) continue;
      const entries = targets.get(day.employeeId);
      if (entries) entries.push(day);
      else targets.set(day.employeeId, [day]);
    }
    return targets;
  }, [input.assignments, input.employees, dates, first.employeeId, first.date, administrative]);
  const choices = [...(targetsByEmployee.get(employeeId) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const target = choices.find(day => day.date === (date || first.date));
  return <details className={styles.editorImpact}>
    <summary className={styles.disclosureTrigger}>Trocar com outro dia</summary>
    <p className={styles.muted}>Escolha o outro dia para trocar os horários ou as folgas entre os dois.</p>
    {targetsByEmployee.size === 0 && <p className={styles.muted}>Nenhum outro dia editável neste período.</p>}
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setError("");
      if (!canApply || !target || current) return;
      try {
        const origin = input.assignments.find(day => day.employeeId === first.employeeId && day.date === first.date);
        if (origin?.kind === "HOLIDAY") {
          throw new Error("Feriados registrados não podem ser trocados. Escolha outro dia.");
        }
        const second: RosterDay = { employeeId: target.employeeId, date: target.date };
        const next = swapRosterDays(input, first, second, { branchScoped: !administrative });
        const person = input.employees.find(person => person.id === target.employeeId);
        const summary = `Troca de ${displayDate(first.date)} com ${person?.name ?? "colaborador"} em ${displayDate(target.date)}`;
        setPreview({ source: input, input: next, administrative, summary, impact: inspectRosterChanges(input, next) });
      }
      catch (cause) { setPreview(null); setError(errorMessage(cause)); }
    }}>
      <fieldset disabled={Boolean(current) || !canApply || targetsByEmployee.size === 0} className={styles.formGrid}>
        <Field label="Colaborador para a troca">{(id) => <select id={id} required value={employeeId} className={controlClass} onChange={event => { setEmployeeId(event.target.value); setDate(""); setError(""); }}>
          <option value="" disabled>Escolha o colaborador</option>
          {input.employees.filter(person => targetsByEmployee.has(person.id)).map(person => <option key={person.id} value={person.id}>{person.name === "" ? person.registration : `${person.name} · ${person.registration}`}{person.id === first.employeeId ? " (mesma pessoa)" : ""}</option>)}
        </select>}</Field>
        <Field label="Data para a troca">{(id) => <select id={id} required disabled={!employeeId} value={target?.date ?? ""} className={controlClass} onChange={event => { setDate(event.target.value); setError(""); }}>
          <option value="" disabled>{employeeId ? "Escolha o dia" : "Selecione o colaborador primeiro"}</option>
          {choices.map(day => <option key={day.date} value={day.date}>{displayDate(day.date)} · {dayLabel(day, input.shifts)}</option>)}
        </select>}</Field>
        <div className={styles.actions}><button ref={trigger} type="submit" className={buttonClass} disabled={!target}>Conferir troca</button></div>
      </fieldset>
    </form>
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {current && <Impact preview={current} summary={current.summary} confirm={() => onApply(current.input)} cancel={() => { returnFocus(); setPreview(null); }} />}
  </details>;
}
