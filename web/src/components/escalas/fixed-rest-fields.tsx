"use client";

import { useId } from "react";
import { fixedRestSlots, withFixedRestSlots } from "@/lib/escalas/fixed-rest";
import { branchClosesOnSunday } from "@/lib/escalas/rest-configuration";
import type { EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { controlClass, Field } from "./controls";

const SLOTS = [{ label: "Primeira folga", index: 0 }, { label: "Segunda folga", index: 1 }] as const;
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
    <legend className="text-sm font-semibold">Folgas semanais deste colaborador</legend>
    <p id={`${id}-help`} className="text-sm text-[color:var(--app-muted)]">
      {hoursOnly
        ? "Este planejamento ajusta apenas os horários e mantém as folgas da grade."
        : "Escolha um dia fixo ou deixe a folga no rodízio. A escolha vale para a próxima geração da escala."}
    </p>
    {sundayClosed && <p className="text-sm">A filial 02 fecha aos domingos. O domingo já conta como uma das duas folgas da semana.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {SLOTS.map(({ label, index }) => {
        const slot = slots[index];
        const other = slots[1 - index];
        const duplicate = other.enabled && other.weekday === slot.weekday;
        const choice = slot.enabled ? String(slot.weekday) : slot.weekday === null ? "" : "variable";
        return <Field key={label} label={label}
          hint={duplicate ? "Este dia já foi fixado na outra folga. Selecione um dia diferente." : undefined}>
          {(fieldId, accessibility) => <select id={fieldId} {...accessibility} className={controlClass} disabled={hoursOnly}
            value={choice}
            onChange={event => {
              const next = fixedRestSlots(employee);
              const selected = event.target.value;
              next[index] = selected === "" ? { weekday: null, enabled: false }
                : selected === "variable" ? { weekday: slot.weekday, enabled: false }
                  : { weekday: Number(selected), enabled: true };
              onChange(withFixedRestSlots(employee, next));
            }}>
            <option value="">{slot.weekday === null ? "No rodízio" : "No rodízio, apagar dia guardado"}</option>
            {slot.weekday !== null && <option value="variable">{slot.enabled
              ? `Voltar ao rodízio e guardar ${DAYS[slot.weekday].toLocaleLowerCase("pt-BR")}`
              : `No rodízio · dia guardado (${DAYS[slot.weekday].toLocaleLowerCase("pt-BR")})`}</option>}
            {DAYS.map((day, weekday) => <option key={day} value={weekday}
              disabled={other.enabled && other.weekday === weekday}>Fixa · {day}</option>)}
          </select>}
        </Field>;
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
