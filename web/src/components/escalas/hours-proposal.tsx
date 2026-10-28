"use client";

import { useState } from "react";
import { effectiveWeeklyHours } from "@/lib/escalas/labor-rules";
import { dateRange } from "@/lib/escalas/dates";
import { sortEmployees } from "@/lib/escalas/order";
import { planningWeeklyHours, prepareRoster } from "@/lib/escalas/preparation";
import type { EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { clock, errorMessage } from "./workspace-model";

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
      const target = effectiveWeeklyHours(reference, start) * 12;
      return person.shiftIds.some((id) => { const shift = shifts.get(id); return shift && duration(shift) === target; });
    }));
}

export function prepareHoursProposal(input: EscalaInput, anchor: Anchor): EscalaInput {
  const strategy = anchor === "arrival" ? "PRESERVE_START" : anchor === "departure" ? "PRESERVE_END" : "BOTH";
  return prepareRoster(input, input.defaultWeeklyHours, "EXCLUDE", strategy);
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
      : person.scheduleMode === "MISSING" ? ["Horário não informado · presença e folgas sem horas fictícias"]
      : person.scheduleMode === "UNTIMED" ? ["Rodízio sem horário fixo · horas não apuradas"]
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
  const [preview, setPreview] = useState<{ source: EscalaInput; input: EscalaInput } | null>(null);
  const [error, setError] = useState("");
  const current = preview?.source === input ? preview.input : null;
  const prepared = hoursArePrepared(input);
  const timed = input.employees.filter((person) => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING");
  const groups = current ? hoursProposalGroups(input, current) : [];
  return <section className={panelClass} aria-labelledby="escala-hours-title">
    <h3 id="escala-hours-title" className="font-bold">Alternativas de horário da proposta</h3>
    <p className="text-sm">A carga semanal é distribuída em cinco dias: 40h = 8h00, 42h = 8h24 e 44h = 8h48. O intervalo original é preservado. A geração pode preparar as alternativas automaticamente. Use esta prévia somente quando quiser escolher a estratégia.</p>
    {prepared && <p className="text-sm font-semibold">Os horários incluídos já permitem a carga selecionada. Você pode seguir para as sugestões em massa ou preparar outra alternativa.</p>}
    {timed.length > 0 && <>
      <fieldset disabled={disabled} className="max-w-lg space-y-3">
        <Field label="Como adaptar os horários da filial?">
          {(id) => <select id={id} className={controlClass} value={anchor} onChange={(event) => { setAnchor(event.target.value as Anchor); setPreview(null); }}>
            <option value="arrival">Manter entrada e intervalo, ajustar a saída (recomendado)</option>
            <option value="departure">Manter saída e intervalo, ajustar a entrada</option>
            <option value="both">Permitir alternativas com entrada ou saída preservada</option>
          </select>}
        </Field>
        <button type="button" className={buttonClass} onClick={() => {
          setError("");
          try { setPreview({ source: input, input: prepareHoursProposal(input, anchor) }); }
          catch (cause) { setError(errorMessage(cause)); }
        }}>Ver proposta de horários para {input.defaultWeeklyHours}h</button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    </>}
    {!timed.length && <p className="text-sm">Pessoas sem horário fixo entram diretamente no rodízio de folgas, sem jornada ou horas fictícias.</p>}
    {current && <div className="space-y-3">
      <p className="text-sm font-semibold">Prévia agrupada: {groups.length} combinações de setor, cargo e horário · {current.employees.filter((person) => person.planningEnabled !== false).length} incluídos · {current.employees.filter((person) => person.planningEnabled === false).length} fora da geração, com motivo identificado.</p>
      <p className="text-sm">Quando houver duas alternativas, o cálculo das folgas escolherá entre elas para melhorar a cobertura. Os mínimos da operação serão conferidos na etapa seguinte.</p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Horário original e proposta agrupados por setor, cargo e horário</caption>
          <thead><tr><th scope="col" className="p-2">Setor / cargo / equipe</th><th scope="col" className="p-2">Horário de referência</th><th scope="col" className="p-2">Horários permitidos na proposta</th></tr></thead>
          <tbody>{groups.map((group) => <tr key={group.key} className="border-t border-[color:var(--app-border)]">
            <th scope="row" className="p-2 font-normal">{group.sector} / {group.role}
              <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">{group.people.length} colaborador(es) · ver nomes</summary>
                <ul>{group.people.map((name) => <li key={name}>{name}</li>)}</ul>
              </details>
            </th>
            <td className="p-2">{group.original}</td>
            <td className="p-2">{group.proposal.map((value) => <p key={value}>{value}</p>)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-sm">Aplicar estes horários substitui as atribuições não bloqueadas, preserva ausências e exige gerar novamente as folgas. A autorização coletiva continua sendo conferida separadamente.</p>
      <button type="button" className={primaryClass} disabled={disabled} onClick={() => { onChange(current); setPreview(null); }}>Escolher estes horários e continuar</button>
    </div>}
  </section>;
}
