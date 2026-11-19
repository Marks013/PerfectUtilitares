"use client";

import { useId } from "react";
import { fixedRestSlots, withFixedRestSlots } from "@/lib/escalas/fixed-rest";
import { branchClosesOnSunday } from "@/lib/escalas/rest-configuration";
import type { EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { Check, controlClass } from "./controls";

const DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

/** The only writer for personal fixed slots; closing rules never enable these controls. */
export function FixedRestFields({ employee, input, onChange }: {
  employee: EscalaEmployee; input: EscalaInput; onChange: (person: EscalaEmployee) => void;
}) {
  const id = useId();
  const slots = fixedRestSlots(employee);
  const hoursOnly = input.generationMode === "HOURS_ONLY";
  const sundayClosed = branchClosesOnSunday(input);
  return <fieldset className="space-y-3 sm:col-span-2 lg:col-span-3" aria-describedby={`${id}-help`}>
    <legend className="text-sm font-semibold">Folgas fixas individuais (opcional)</legend>
    <p id={`${id}-help`} className="text-sm text-[color:var(--app-muted)]">
      Cadastre cada dia e habilite somente a folga que deseja fixar. Desabilitar preserva o dia cadastrado.
      O Solver não habilita estes controles automaticamente. {hoursOnly && "Apenas horários preserva a grade e não altera estas regras."}
    </p>
    {sundayClosed && <p className="text-sm">Filial 02: domingo fechado. O domingo já ocupa uma folga semanal; a outra permanece variável, salvo escolha explícita compatível.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {slots.map((slot, index) => {
        const other = slots[1 - index];
        const duplicate = other.enabled && other.weekday === slot.weekday;
        return <div key={index} className="space-y-2">
          <label htmlFor={`${id}-${index}`} className="block text-sm font-semibold">Dia da folga fixa {index + 1}</label>
          <select id={`${id}-${index}`} className={controlClass} disabled={hoursOnly}
            aria-describedby={`${id}-help ${id}-${index}-status`} value={slot.weekday ?? ""}
            onChange={event => {
              const next = fixedRestSlots(employee), weekday = event.target.value === "" ? null : Number(event.target.value);
              next[index] = { ...next[index], weekday, enabled: weekday === null ? false : next[index].enabled };
              onChange(withFixedRestSlots(employee, next));
            }}>
            <option value="">Selecione o dia</option>
            {DAYS.map((day, weekday) => <option key={day} value={weekday}
              disabled={slot.enabled && other.enabled && other.weekday === weekday}>{day}</option>)}
          </select>
          <Check label={`Habilitar folga fixa ${index + 1}`} checked={slot.enabled}
            disabled={hoursOnly || slot.weekday === null || !slot.enabled && duplicate}
            onChange={enabled => {
              const next = fixedRestSlots(employee); next[index] = { ...next[index], enabled };
              onChange(withFixedRestSlots(employee, next));
            }} />
          <p id={`${id}-${index}-status`} className="min-h-10 text-sm text-[color:var(--app-muted)]">
            {slot.enabled ? "Habilitada: o dia será preservado na próxima geração."
              : slot.weekday === null ? "Escolha o dia antes de habilitar." : duplicate
                ? "O outro controle já fixa este dia. Escolha outro para habilitar."
                : "Desabilitada: o dia está guardado, mas não fixa a escala."}
          </p>
        </div>;
      })}
    </div>
    {slots.some(slot => slot.enabled && slot.weekday === 5) && <p role="status" className="text-sm">
      A regra atual não permite folga comum no sábado. Esta escolha conflita com a geração; nenhum bloqueio será removido automaticamente.
    </p>}
    {sundayClosed && new Set([6, ...employee.fixedOffDays]).size > 2 && <p role="status" className="text-sm">
      Domingo fechado e os dois dias habilitados somam três descansos. Desabilite um dia ou inclua domingo entre as duas folgas fixas.
    </p>}
  </fieldset>;
}
