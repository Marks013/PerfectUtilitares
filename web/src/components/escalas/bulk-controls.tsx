"use client";

import { useState } from "react";
import { prepareRoster } from "@/lib/escalas/preparation";
import type { EscalaInput, WeeklyHours } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field } from "./controls";
import { errorMessage, HOURS } from "./workspace-model";

export function BulkControls({ input, disabled, onChange }: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  const [hours, setHours] = useState<WeeklyHours>(input.defaultWeeklyHours);
  const [useDefault, setUseDefault] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="space-y-3 border-b border-[color:var(--app-border)] pb-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Configurar equipe em lote</summary>
      <p className="text-sm text-[color:var(--app-muted)]">
        Aplique a carga de referência e o descanso quinzenal protetivo a todos da filial em uma ação.
        Os horários adaptados são uma proposta, respeitam as vigências e preservam os horários originais como referência.
        Pessoas sem horário fixo entram no rodízio de trabalho e folgas, sem turno e sem apuração de horas.
        Cargas menores já cadastradas são preservadas. Admissão e histórico são opcionais.
        As atribuições não bloqueadas são descartadas, preservando ausências. Gere novamente a proposta após aplicar.
        Se houver dias bloqueados, a configuração em lote será recusada.
      </p>
      <Field label="Carga semanal da equipe">
        {(id) => <select id={id} className={controlClass} value={hours} disabled={disabled}
          onChange={(event) => setHours(Number(event.target.value) as WeeklyHours)}>
          {HOURS.map((value) => <option key={value} value={value}>{value} horas</option>)}
        </select>}
      </Field>
      <Check label="Usar horário padrão para cadastros com horário que precisam de adaptação (início 08:00, intervalo 12:00–13:00)"
        checked={useDefault} disabled={disabled} onChange={setUseDefault} />
      <p className="text-sm">Para cadastros com horário, jornadas originais inferiores a 6h e horários noturnos sem adaptação diurna ficam fora da geração até conferir essas exceções. A opção acima propõe um novo horário. Pessoas sem horário fixo já participam do rodízio e não recebem esse padrão.</p>
      <p className="text-sm font-semibold">{input.employees.filter((person) => person.planningEnabled !== false).length} incluídos na geração · {input.employees.filter((person) => person.planningEnabled === false).length} fora da geração</p>
      <button type="button" className={buttonClass} disabled={disabled || !input.employees.length}
        onClick={() => {
          setError("");
          try { onChange(prepareRoster(input, hours, useDefault ? "BRANCH_DEFAULT" : "EXCLUDE")); }
          catch (cause) { setError(errorMessage(cause)); }
        }}>Aplicar configuração à equipe</button>
      {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    </details>
  );
}
