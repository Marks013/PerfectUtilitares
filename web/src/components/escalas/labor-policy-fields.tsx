"use client";

import type { EscalaInput } from "@/lib/escalas/types";
import { Check } from "./controls";
import styles from "./escalas.module.css";
import { clock } from "./workspace-model";

type Props = { input: EscalaInput; onChange: (input: EscalaInput) => void };

/** Documentary data is retained in the backend, never fabricated by a draft control. */
export function LaborPolicyFields({ input }: Props) {
  return <p className={styles.muted}>Você pode gerar o rascunho sem preencher documentos. A conferência formal é separada do planejamento.{input.policy.reviewed && " A conferência já registrada foi preservada."}</p>;
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
  return <details id="escala-short-meal" className={styles.disclosure}>
    <summary className={styles.disclosureTrigger}>Intervalos de jornadas curtas{policy.allowShortMealSimulation ? " · opção ativa" : " · opcional"}</summary>
    <fieldset className={styles.stackSmall}>
      <legend className="sr-only">Simulação de jornadas curtas</legend>
      <Check label="Simular jornadas de 4 a 6 horas sem pausa" checked={policy.allowShortMealSimulation ?? false}
        onChange={value => onChange({ ...input, simulation: true, needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
          policy: { ...policy, allowShortMealSimulation: value } })} />
      <p className={styles.muted}>Permite testar jornadas acima de 4h e até 6h sem os 15 minutos de pausa. Não autoriza dispensar pausas no trabalho real. Jornadas maiores mantêm o intervalo de refeição. Gere novamente após mudar esta opção.</p>
      {affectedShortShifts.length > 0 ? <details>
        <summary className={styles.disclosureTrigger}>Ver {affectedShortShifts.length} horário(s) afetado(s)</summary>
        <ul className={styles.referenceList}>{affectedShortShifts.map(shift => <li key={shift.id}><strong>{shift.name}</strong>{shift.segments.filter(segment => segment.kind === "WORK").map(segment => clock(segment.start) + "–" + clock(segment.end)).join(" / ")}</li>)}</ul>
      </details> : <p className={styles.muted}>Nenhum horário atual precisa dessa opção.</p>}
    </fieldset>
  </details>;
}
