"use client";

import { useId } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { changeGenerationMode } from "./workspace-model";
import styles from "./escalas.module.css";

export function hasHourReferences(input: EscalaInput) {
  const shifts = new Set(input.shifts.filter(shift => shift.segments.some(segment => segment.kind === "WORK")).map(shift => shift.id));
  return input.employees.some(person => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"
    && person.shiftIds.some(id => shifts.has(id)));
}

export function GenerationModeOption({ input, disabled, onChange }: {
  input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void;
}) {
  const id = useId();
  const mode = input.generationMode ?? "DAYS_AND_HOURS";
  return <fieldset disabled={disabled} aria-describedby={id + "-help"} className={styles.stackSmall}>
    <legend className={styles.fieldLabel}>O que gerar?</legend>
    <div className={styles.actions}>
      {([{ value: "DAYS_AND_HOURS", label: "Folgas e horários" }, { value: "REST_ONLY", label: "Só folgas" }, { value: "HOURS_ONLY", label: "Só horários" }] as const).map(option => <label key={option.value} className={styles.check}>
        <input type="radio" name={id} value={option.value} checked={mode === option.value} className={styles.checkInput} onChange={() => onChange(changeGenerationMode(input, option.value))} />
        <span>{option.label}</span>
      </label>)}
    </div>
    <p id={id + "-help"} className={styles.muted}>{mode === "HOURS_ONLY"
      ? "Ajusta somente os horários. Folgas, afastamentos e dias de trabalho já definidos são mantidos. Sem grade, gera referências de horário para conferir e exportar, sem criar presenças ou folgas."
      : mode === "REST_ONLY"
      ? "Reutiliza horários de referência ajustados à jornada escolhida, sem otimizar entradas e saídas. Na jornada mista, ainda distribui os dias de 8h e 9h. Horários bloqueados são preservados."
      : "Distribui folgas e procura os horários permitidos que melhor atendem cada setor. Você confere antes de aplicar."}</p>
  </fieldset>;
}
