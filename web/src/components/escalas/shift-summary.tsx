"use client";

import { visibleDates } from "@/lib/escalas/dates";
import { escalaDuration, escalaShiftCodes } from "@/lib/escalas/presentation";
import type { EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { buttonClass } from "./controls";
import styles from "./escalas.module.css";

/** Stable shift IDs remain distinct, even when two imported references share a description. */
export function ShiftSummary({ input, usedOnly = false, disabled = false, onEdit }: {
  input: EscalaInput; usedOnly?: boolean; disabled?: boolean; onEdit?: (shift: EscalaShift) => void;
}) {
  const codes = escalaShiftCodes(input);
  const people = input.employees.filter((person) => person.planningEnabled !== false);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const visible = new Set(visibleDates(input));
  const usedByShift = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    const person = peopleById.get(assignment.employeeId);
    if (assignment.kind !== "WORK" || !assignment.shiftId || !person || !visible.has(assignment.date) || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || assignment.date < person.activeFrom || (person.activeUntil && assignment.date > person.activeUntil)) continue;
    const ids = usedByShift.get(assignment.shiftId) ?? new Set<string>();
    ids.add(person.id); usedByShift.set(assignment.shiftId, ids);
  }
  const shifts = input.shifts.filter((shift) => !usedOnly || usedByShift.has(shift.id));
  if (!shifts.length) return <p className={styles.muted}>{usedOnly ? "Nenhum turno com horário foi aplicado à grade. Gere e aplique uma proposta para conferir os horários utilizados." : "Nenhum turno disponível. Importe a equipe ou adicione um horário."}</p>;
  return <div className={styles.shiftSummary}>
    <p className={styles.muted}>T01, T02 e demais códigos identificam horários distintos. Intervalos não contam como atendimento.</p>
    <ul className={styles.shiftList} aria-label={usedOnly ? "Turnos utilizados na escala" : "Turnos disponíveis para a proposta"}>
      {shifts.map((shift) => {
        const users = people.filter((person) => usedByShift.get(shift.id)?.has(person.id));
        const allowed = people.filter((person) => person.shiftIds.includes(shift.id));
        const references = users.length ? users : allowed;
        const sectors = [...new Set(references.map((person) => person.sector))].sort((a, b) => a.localeCompare(b, "pt-BR"));
        const work = shift.segments.filter((segment) => segment.kind === "WORK");
        const pauses = shift.segments.filter((segment) => segment.kind !== "WORK");
        const minutes = work.reduce((sum, segment) => sum + segment.end - segment.start, 0);
        const paid = pauses.filter((segment) => segment.kind === "PAID_BREAK").reduce((sum, segment) => sum + segment.end - segment.start, 0);
        const sources = new Map<string, { code: string; weekday: string; saturday: string; description: string }>();
        for (const person of references) if (person.sourceSchedule) sources.set(JSON.stringify(person.sourceSchedule), person.sourceSchedule);
        return <li key={shift.id} className={styles.shiftRow}>
          <div className={styles.shiftIdentity}><strong>{codes.get(shift.id)}</strong><span className={styles.muted}>{shift.name}</span></div>
          <dl className={styles.shiftFacts}>
            <div><dt>Horário proposto</dt><dd>{work.map((segment) => `${escalaDuration(segment.start)}–${escalaDuration(segment.end)}`).join(" / ") || "Sem período de trabalho"}</dd></div>
            <div><dt>Intervalo</dt><dd>{pauses.map((segment) => `${escalaDuration(segment.start)}–${escalaDuration(segment.end)}${segment.kind === "PAID_BREAK" ? " (remunerado)" : ""}`).join(" / ") || "Sem intervalo informado"}</dd></div>
            <div><dt>Trabalho efetivo</dt><dd>{escalaDuration(minutes)}{paid > 0 && <span className={styles.muted}> + {escalaDuration(paid)} de pausa remunerada</span>}</dd></div>
            <div><dt>Colaboradores</dt><dd>{users.length} na grade{!usedOnly && <span className={styles.muted}> · {allowed.length} habilitado(s)</span>}</dd></div>
            <div><dt>Setores{users.length ? " na grade" : " de referência"}</dt><dd>{sectors.join(", ") || "Sem colaborador vinculado"}</dd></div>
          </dl>
          {(sources.size > 0 || onEdit) && <div className={styles.shiftSecondary}>
            {sources.size > 0 && <details><summary className={styles.disclosureTrigger}>Comparar com o horário original importado</summary><ul className={styles.referenceList}>{[...sources.entries()].map(([key, source]) => <li key={key}><strong>Original {source.code} · {source.description}</strong><span>Dias úteis: {source.weekday || "não informado"}</span><span>Sábado: {source.saturday || "não informado"}</span></li>)}</ul></details>}
            {onEdit && <button type="button" className={buttonClass} disabled={disabled} onClick={() => onEdit(shift)}>Editar {codes.get(shift.id)}</button>}
          </div>}
        </li>;
      })}
    </ul>
  </div>;
}
