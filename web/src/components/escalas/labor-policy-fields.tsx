"use client";

import type { EscalaInput } from "@/lib/escalas/types";
import { Check } from "./controls";
import { clock } from "./workspace-model";

type Props = { input: EscalaInput; onChange: (input: EscalaInput) => void };

/** Documentary data is retained in the backend, never fabricated by a draft control. */
export function LaborPolicyFields({ input }: Props) {
  return <p className="text-sm text-[color:var(--app-muted)]">Premissas operacionais aplicadas no cálculo. Documentos e autorizações não são exigidos para simular. Dados administrativos já registrados permanecem preservados no servidor, sem confirmação automática.{input.policy.reviewed && " Esta revisão conserva uma conferência administrativa previamente registrada."}</p>;
}

export function ShortMealSimulation({ input, onChange }: Props) {
  const policy = input.policy;
  const allowed = new Set(input.employees.filter(person => person.planningEnabled !== false).flatMap(person => person.shiftIds));
  const affectedShortShifts = input.shifts.filter(shift => {
    if (!allowed.has(shift.id)) return false;
    const paid = shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
    const first = shift.segments[0]?.start ?? 0, last = shift.segments.at(-1)?.end ?? 0;
    const meal = Math.max(0, ...shift.segments.filter(segment => segment.kind === "BREAK" && segment.start > first && segment.end < last).map(segment => segment.end - segment.start));
    return paid > 240 && paid <= 360 && meal < 15;
  });
  return <>
      {(affectedShortShifts.length > 0 || policy.allowShortMealSimulation) && (
        <fieldset className="space-y-3 rounded-lg border border-[color:var(--app-border)] p-3 text-sm">
          <legend className="px-1 font-semibold">Simulação de jornadas curtas</legend>
          <p>
            Não existe um teto diário de 4h. A regra atual exige uma pausa de 15 minutos nas jornadas acima de 4h e até 6h.
            Jornadas acima de 6h continuam exigindo o intervalo para refeição configurado.
          </p>
          <Check
            label="Simular jornada de mais de 4h até 6h sem pausa mínima de 15min"
            checked={policy.allowShortMealSimulation ?? false}
            onChange={value => onChange({ ...input, simulation: true, needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
              policy: { ...policy, allowShortMealSimulation: value } })}
          />
          <p className="text-[color:var(--app-muted)]">
            Opção desativada por padrão e válida somente neste cenário de simulação. Não autoriza o uso operacional,
            não muda o limite de 5 dias consecutivos, bloqueios, afastamentos ou os demais intervalos.
            Gere uma nova proposta após alterar a opção.
          </p>
          {affectedShortShifts.length > 0 ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-medium">Horários afetados ({affectedShortShifts.length})</summary>
              <ul className="space-y-2">
                {affectedShortShifts.map(shift => <li key={shift.id}>
                  <strong>{shift.name}</strong>: {shift.segments.filter(segment => segment.kind === "WORK").map(segment => clock(segment.start) + "–" + clock(segment.end)).join(" / ")}.
                  {" "}Pausa informada inferior a 15 minutos.
                </li>)}
              </ul>
            </details>
          ) : <p>Nenhum horário atual exige essa flexibilização.</p>}
        </fieldset>
      )}
  </>;
}
