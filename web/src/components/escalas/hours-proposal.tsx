"use client";

import { useState } from "react";
import styles from "./escalas.module.css";
import { effectiveWeeklyMinutes } from "@/lib/escalas/labor-rules";
import { dateRange } from "@/lib/escalas/dates";
import { sortEmployees } from "@/lib/escalas/order";
import { planningWeeklyHours, requiresWorkBlockBalance } from "@/lib/escalas/preparation";
import { adaptCompatibleSchedules, type ScheduleException } from "@/lib/escalas/schedule-adaptation";
import type { EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { changeContinuousWorkLimit, clock, errorMessage } from "./workspace-model";

export function ContinuousWorkOption({ input, disabled, onChange }: { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void }) {
  const enabled = input.policy.limitContinuousWorkBlocks === true;
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const longLocked = enabled && input.assignments.some(day => {
    const shift = day.locked && day.kind === "WORK" && day.shiftId ? shifts.get(day.shiftId) : undefined;
    return shift && requiresWorkBlockBalance(shift);
  });
  return <div className={styles.stackSmall}>
    <div><Check label="Limitar cada bloco a 4h30" checked={enabled} disabled={disabled} onChange={checked => onChange(changeContinuousWorkLimit(input, checked))} /><p className={styles.muted}>Redistribui os dois períodos de trabalho, mantendo a jornada e a duração do intervalo.</p></div>
    {longLocked && <p role="status" className={styles.muted}>Este horário está bloqueado e foi mantido. Desbloqueie o dia se quiser ajustar os períodos de trabalho.</p>}
  </div>;
}

type Anchor = "arrival" | "departure" | "both";
function duration(shift: EscalaShift) {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}
function shiftText(shift: EscalaShift) {
  return shift.segments.map((segment) => `${segment.kind === "BREAK" ? "intervalo " : ""}${clock(segment.start)}–${clock(segment.end)}`).join(" · ");
}

export function hoursArePrepared(input: EscalaInput) {
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const weeks = dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0);
  return input.employees.filter((person) => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING")
    .every((person) => weeks.every((start) => {
      const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
      const target = effectiveWeeklyMinutes({ ...person, ...reference }, start) / 5;
      return person.shiftIds.some((id) => { const shift = shifts.get(id); return shift && duration(shift) === target; });
    }));
}

export function prepareHoursProposal(input: EscalaInput, anchor: Anchor): EscalaInput {
  const strategy = anchor === "arrival" ? "PRESERVE_START" : anchor === "departure" ? "PRESERVE_END" : "BOTH";
  return adaptCompatibleSchedules(input, strategy).input;
}

/** Group equivalent proposals so a branch review does not require editing each person. */
export function hoursProposalGroups(input: EscalaInput, proposed: EscalaInput) {
  const before = new Map(input.employees.map((person) => [person.id, person]));
  const beforeShifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const afterShifts = new Map(proposed.shifts.map((shift) => [shift.id, shift]));
  const groups = new Map<string, { sector: string; role: string; original: string; proposal: string[]; people: string[] }>();
  for (const person of sortEmployees(proposed.employees)) {
    const previous = before.get(person.id);
    const original = person.sourceSchedule?.weekday || previous?.shiftIds.map((id) => {
      const shift = beforeShifts.get(id);
      return shift ? shiftText(shift) : "";
    }).join(" / ") || "Sem horário fixo";
    const proposal = person.planningEnabled === false ? [person.planningExclusionReason || "Fora da geração"]
      : person.scheduleMode === "MISSING" ? ["Sem horário fixo · folgas planejadas"]
      : person.scheduleMode === "UNTIMED" ? ["ENC · folgas planejadas sem horário fixo"]
      : person.shiftIds.flatMap((id) => {
        const shift = afterShifts.get(id);
        return shift ? [`${shiftText(shift)} (${clock(duration(shift))} trabalhadas)`] : [];
      });
    const key = JSON.stringify([person.sector, person.role, original, proposal]);
    const group = groups.get(key) ?? { sector: person.sector, role: person.role, original, proposal, people: [] };
    group.people.push(`${person.name} · ${person.registration}`);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

export function HoursProposal({ input, disabled, onChange }: { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void }) {
  const [anchor, setAnchor] = useState<Anchor>("arrival");
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const groups = hoursProposalGroups(input, input);
  const timed = input.employees.some(person => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING");
  function apply(strategy: Anchor) {
    setError(""); setNotice("");
    try {
      const prepared = adaptCompatibleSchedules(input, strategy === "arrival" ? "PRESERVE_START" : strategy === "departure" ? "PRESERVE_END" : "BOTH");
      setExceptions(prepared.exceptions); onChange(prepared.input);
      setNotice(prepared.exceptions.length ? "Horários compatíveis ajustados. As exceções abaixo permanecem incluídas, sem alteração de restrições." : "Horários ajustados no rascunho. O salvamento automático confirmará a revisão; gere novamente as folgas.");
    } catch (cause) { setError(errorMessage(cause)); }
  }
  return <details className={panelClass} aria-labelledby="escala-adjust-hours-title">
    <summary id="escala-adjust-hours-title" className={styles.disclosureTrigger}>Horários para {input.defaultWeeklyHours}h · conferir ou ajustar manualmente</summary>
    <p className={styles.muted}>Ao gerar, o sistema sugere os horários usando a jornada escolhida. Use esta área se quiser manter a saída ou comparar os originais. Intervalos e dias bloqueados são preservados.</p>
    {timed ? <fieldset disabled={disabled} className="flex flex-wrap items-end gap-3">
      <Field label="Como ajustar os horários?">{id => <select id={id} className={controlClass} value={anchor} onChange={event => setAnchor(event.target.value as Anchor)}>
        <option value="arrival">Manter entrada e intervalo, ajustar a saída</option><option value="departure">Manter saída e intervalo, ajustar a entrada</option><option value="both">Comparar alternativas de entrada ou saída preservada</option>
      </select>}</Field>
      <button type="button" className={primaryClass} onClick={() => apply(anchor)}>Ajustar horários no rascunho</button>
    </fieldset> : <p className="text-sm">Pessoas sem horário fixo participam normalmente das folgas. A contagem por hora considera somente horários informados.</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    {exceptions.length > 0 && <div className="space-y-2 text-sm"><h4 className="font-semibold">Horários que precisam de escolha individual</h4><ul>{exceptions.map(person => <li key={person.employeeId}>{person.registration} · {person.name}: {person.reason}</li>)}</ul><button type="button" className={buttonClass} disabled={disabled || anchor === "departure"} onClick={() => { setAnchor("departure"); apply("departure"); }}>Experimentar manter a saída</button></div>}
    {groups.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Comparar horário original e proposto ({groups.length} grupos)</summary><div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Horário original e proposto por setor e cargo</caption><thead><tr><th scope="col" className="p-2">Setor / cargo / equipe</th><th scope="col" className="p-2">Original importado</th><th scope="col" className="p-2">Proposto no cenário</th></tr></thead><tbody>{groups.map(group => <tr key={group.key} className="border-t border-[color:var(--app-border)]"><th scope="row" className="p-2 font-normal">{group.sector} / {group.role}<details><summary className="cursor-pointer py-2">{group.people.length} colaborador(es)</summary><ul>{group.people.map(name => <li key={name}>{name}</li>)}</ul></details></th><td className="p-2">{group.original}</td><td className="p-2">{group.proposal.map(value => <p key={value}>{value}</p>)}</td></tr>)}</tbody></table></div></details>}
  </details>;
}
