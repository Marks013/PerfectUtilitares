"use client";

import { isEscalaPlanningParticipant } from "@/lib/escalas/eligibility";
import { useEffect, useRef, useState } from "react";
import styles from "./escalas.module.css";
import type { EscalaAssignment, EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, primaryClass } from "./controls";
import { applyRosterChanges, canEditBranchRosterDay, inspectRosterChanges, rosterShiftOptions, swapRosterDays, type RosterDay } from "./roster-model";
import { clock, displayDate, errorMessage } from "./workspace-model";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";

type Preview = { source: EscalaInput; input: EscalaInput; impact: ReturnType<typeof inspectRosterChanges> };

function Impact({ preview, confirm, cancel }: { preview: Preview; confirm: () => void; cancel: () => void }) {
  const access = useEscalaClientAccess();
  const { impact } = preview;
  const analytics = canDisplayEscalaAction(access, "report.analytics", preview.source.branchCode);
  const newErrors = analytics ? impact.newErrors : impact.newErrors.filter((issue) =>
    issue.code !== "COVERAGE_DEFICIT" && issue.code !== "ESTIMATED_COVERAGE_GAP");
  const issues = [...newErrors, ...(analytics ? impact.coverageIssues.filter((issue) => issue.severity !== "ERROR") : [])];
  return <section className={styles.editorImpact} aria-label="Impacto da alteração">
    <p className="font-semibold">Prévia: {impact.changedDays} dia(s) alterado(s)</p>
    <p className="text-sm">Descansos e jornada dos colaboradores afetados foram conferidos, incluindo os dias anteriores e seguintes.{analytics && " A cobertura foi recalculada nos setores e dias afetados."}</p>
    <p className="text-sm">{newErrors.length ? `${newErrors.length} novo(s) conflito(s). Você pode manter a simulação em rascunho, mas precisa resolvê-los antes de publicar.` : "Nenhum novo conflito obrigatório foi identificado nesta alteração."}</p>
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
  const [kind, setKind] = useState<EscalaAssignment["kind"]>(assignment?.kind ?? (untimed ? "DUTY" : "WORK"));
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
  const branchLocked = !administrative && assignment !== undefined && !canEditBranchRosterDay(assignment);
  const current = canApply && !protectedDay && !branchLocked && preview?.source === input
    && (administrative || preview.assignment.locked === false) ? preview : null;
  return <form ref={editor} id="escala-day-editor" tabIndex={-1} className={styles.editor} onSubmit={(event) => {
    event.preventDefault();
    setError("");
    try {
      if (!canApply || protectedDay || branchLocked) return;
      if (wasLocked && (!mayUnlock || locked)) throw new Error("Desbloqueie e salve este dia antes de alterar a jornada.");
      if (!administrative && kind === "ABSENCE") throw new Error("Peça ao administrador para ajustar afastamentos.");
      const next: EscalaAssignment = {
        employeeId: employee.id, date, kind,
        ...(kind === "WORK" ? { shiftId } : {}),
        locked: administrative ? locked : false,
      };
      const proposed = applyRosterChanges(input, [next], mayUnlock);
      setPreview({ source: input, input: proposed, assignment: next, impact: inspectRosterChanges(input, proposed) });
    } catch (cause) { setError(errorMessage(cause)); }
  }}>
    <h3 className="font-semibold">{employee.name} · {displayDate(date)}</h3>
    <p className={styles.muted}>Cargo: {employee.role}. A situação escolhida vale para este dia; ENC indica presença sem horário fixo, não o cargo.</p>
    {employee.sourceSchedule && <p className={styles.muted}>Horário importado: {employee.sourceSchedule.weekday}. Referência {employee.sourceSchedule.code} · {employee.sourceSchedule.description}.</p>}
    {employee.scheduleMode === "MISSING" && <p className="text-sm">Essa pessoa participa normalmente das folgas. Sem horário fixo informado, ela não entra na contagem por hora.</p>}
    {wasLocked && <p className="text-sm">Esta decisão está bloqueada. Um administrador autorizado pode desmarcar o bloqueio e salvar a revisão. Só depois poderá alterar a jornada.</p>}
    {branchLocked && !protectedDay && !wasLocked && <p className={styles.muted}>Este dia registrado não está liberado para edição pela filial. Consulte o administrador.</p>}
    {protectedDay && <p className={styles.muted}>Afastamentos e feriados registrados são preservados. Consulte o administrador para corrigir este dia.</p>}
    <fieldset disabled={Boolean(current) || protectedDay || branchLocked || !canApply} className="space-y-3">
      <div className={styles.formGrid}>
        <Field label="Situação do dia">{(id) => <select id={id} disabled={wasLocked} value={kind} className={controlClass} onChange={(event) => setKind(event.target.value as EscalaAssignment["kind"])}>
          {untimed ? <option value="DUTY">{employee.scheduleMode === "UNTIMED" || employee.sourceSchedule?.weekday.replace(/[^0-9]/g, "").match(/^0+$/) ? "ENC — Sem horário fixo" : "NP — Horário ainda não informado"}</option> : <option value="WORK">Trabalho</option>}
          <option value="OFF">Folga</option>
          {(administrative || kind === "ABSENCE") && <option value="ABSENCE">AF — Afastamento</option>}
          {kind === "HOLIDAY" && <option value="HOLIDAY">Feriado</option>}
        </select>}</Field>
        {kind === "WORK" && !untimed && <Field label="Horário de trabalho neste dia">{(id) => <select id={id} required disabled={wasLocked} value={shiftId} className={controlClass} onChange={(event) => setShiftId(event.target.value)}>
          <option value="">Escolha um turno permitido</option>
          {shifts.map((shift) =>
            <option key={shift.id} value={shift.id}>{shift.name} · {shift.segments.map(segment =>
              `${clock(segment.start)}–${clock(segment.end)}${segment.kind === "BREAK" ? " (intervalo)" : segment.kind === "PAID_BREAK" ? " (pausa remunerada)" : ""}`).join(" / ")}</option>)}
        </select>}</Field>}
      </div>
      {administrative && <Check label="Preservar esta decisão nas próximas gerações" checked={locked} disabled={wasLocked && !mayUnlock} onChange={setLocked} />}
      <button type="submit" className={primaryClass} disabled={wasLocked && (!mayUnlock || locked)}>Conferir alteração</button>
    </fieldset>
    {error && <p role="alert" className={styles.errorText}>{error}</p>}
    {current && <Impact preview={current} confirm={() => onApply(current.assignment)} cancel={() => setPreview(null)} />}
    <button type="button" className={buttonClass} onClick={onCancel}>Cancelar edição</button>
  </form>;
}

export function SwapEditor({ input, first, dates, onApply }: { input: EscalaInput; first: RosterDay; dates: string[]; onApply: (next: EscalaInput) => void }) {
  const access = useEscalaClientAccess();
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const canApply = canDisplayEscalaAction(access, "schedule.apply", input.branchCode)
    && canDisplayEscalaAction(access, "workspace.save", input.branchCode);
  const [employeeId, setEmployeeId] = useState(input.employees.find((person) => person.id !== first.employeeId && isEscalaPlanningParticipant(person))?.id ?? first.employeeId);
  const [date, setDate] = useState(first.date);
  const [preview, setPreview] = useState<(Preview & { administrative: boolean }) | null>(null);
  const [error, setError] = useState("");
  const current = canApply && preview?.source === input && preview.administrative === administrative ? preview : null;
  return <details className={styles.editorImpact}>
    <summary className={styles.disclosureTrigger}>Trocar este dia com outro colaborador ou outra data</summary>
    <p className="text-sm">Troque turnos ou folgas. A operação preserva os dois dias juntos e confere se o turno é permitido para cada pessoa.</p>
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setError("");
      if (!canApply) return;
      try {
        const second = { employeeId, date };
        const isSwapped = (day: RosterDay) => (day.employeeId === first.employeeId && day.date === first.date)
          || (day.employeeId === second.employeeId && day.date === second.date);
        if (input.assignments.some((day) => isSwapped(day) && day.kind === "HOLIDAY")) {
          throw new Error("Feriados registrados não podem ser trocados. Escolha outro dia.");
        }
        const next = swapRosterDays(input, first, second, { branchScoped: !administrative });
        setPreview({ source: input, input: next, administrative, impact: inspectRosterChanges(input, next) });
      }
      catch (cause) { setPreview(null); setError(errorMessage(cause)); }
    }}>
      <fieldset disabled={Boolean(current) || !canApply} className="grid gap-3 sm:grid-cols-2">
        <Field label="Colaborador para a troca">{(id) => <select id={id} value={employeeId} className={controlClass} onChange={(event) => setEmployeeId(event.target.value)}>
          {input.employees.filter(isEscalaPlanningParticipant).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.registration} · {person.sector}</option>)}
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
