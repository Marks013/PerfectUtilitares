"use client";
import { useState } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { compareSectors } from "@/lib/escalas/order";
import { isDate } from "@/lib/escalas/dates";
import { buttonClass, controlClass, Field } from "./controls";
import { displayDate } from "./workspace-model";

export function MovementPriorities({ input, disabled, onChange }: { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void }) {
  const [startDate, setStart] = useState(input.startDate), [endDate, setEnd] = useState(input.startDate);
  const [sector, setSector] = useState("");
  const [level, setLevel] = useState<"LOW" | "NORMAL" | "HIGH">("HIGH");
  const [error, setError] = useState("");
  const priorities = input.movementPriorities ?? [];
  const sectors = [...new Set(input.employees.map(person => person.sector))].filter(Boolean).sort(compareSectors);
  const labels = { LOW: "Menor movimento", NORMAL: "Movimento habitual", HIGH: "Maior movimento" };
  function add(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!isDate(startDate) || !isDate(endDate) || startDate < input.startDate || endDate > input.endDate || endDate < startDate) {
      setError("Escolha datas dentro do planejamento, com término igual ou posterior ao início."); return;
    }
    if (priorities.length >= 250) { setError("Há 250 prioridades. Remova uma antes de acrescentar outra."); return; }
    if (priorities.some(item => (item.sector ?? "") === sector && item.startDate <= endDate && startDate <= item.endDate)) {
      setError("Já existe uma prioridade nesse período e abrangência. Remova a anterior ou escolha outras datas."); return;
    }
    onChange({ ...input, movementPriorities: [...priorities, { startDate, endDate, level, ...(sector ? { sector } : {}) }],
      ...(input.assignments.length ? { needsRegeneration: true } : {}) });
  }
  return <details className="space-y-3">
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">Dias de maior movimento e liderança (opcional)</summary>
    <p className="text-sm text-[color:var(--app-muted)]">Informe somente o movimento que você conhece. O algoritmo prefere a presença dos responsáveis nesses dias, sem reduzir a cobertura nem retirar folgas necessárias. Sem informação, não presume movimento maior no fim de semana.</p>
    <form onSubmit={add}>
      <fieldset disabled={disabled} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Movimento a partir de">{id => <input id={id} className={controlClass} type="date" required min={input.startDate} max={input.endDate} value={startDate} onChange={event => setStart(event.target.value)} />}</Field>
          <Field label="Movimento até">{id => <input id={id} className={controlClass} type="date" required min={startDate} max={input.endDate} value={endDate} onChange={event => setEnd(event.target.value)} />}</Field>
          <Field label="Aplicar movimento em">{id => <select id={id} className={controlClass} value={sector} onChange={event => setSector(event.target.value)}><option value="">Toda a filial</option>{sectors.map(item => <option key={item} value={item}>{item}</option>)}</select>}</Field>
          <Field label="Movimento esperado">{id => <select id={id} className={controlClass} value={level} onChange={event => setLevel(event.target.value as typeof level)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}</Field>
        </div>
        <button type="submit" className={buttonClass}>Acrescentar prioridade</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    {priorities.length > 0 && <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
      {priorities.map((priority, index) => <li key={`${priority.startDate}-${priority.endDate}-${priority.sector ?? ""}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--app-border)] py-2">
        <span>{displayDate(priority.startDate)}–{displayDate(priority.endDate)} · {priority.sector || "Toda a filial"} · {labels[priority.level]}</span>
        <button type="button" className={buttonClass} disabled={disabled} aria-label={`Remover prioridade ${index + 1}`} onClick={() => onChange({ ...input,
          movementPriorities: priorities.filter((_, position) => position !== index), ...(input.assignments.length ? { needsRegeneration: true } : {}) })}>Remover</button>
      </li>)}
    </ul>}
    {priorities.length > 0 && <p className="text-xs text-[color:var(--app-muted)]">A indicação de um setor prevalece sobre a da filial nas mesmas datas. Isso é uma preferência operacional, não demanda de pessoal confirmada.</p>}
  </details>;
}
