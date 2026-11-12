"use client";
import { useId, useState } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { compareSectors } from "@/lib/escalas/order";
import { visibleDates } from "@/lib/escalas/dates";
import { buttonClass, Check, controlClass, Field } from "./controls";
import { addMovementSelection, movementRows } from "./movement-priorities-model";
import { displayDate } from "./workspace-model";

export function MovementPriorities({ input, disabled, onChange }: { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void }) {
  const visible = visibleDates(input), first = visible[0] ?? input.startDate, last = visible.at(-1) ?? input.endDate;
  const [startDate, setStart] = useState(first), [endDate, setEnd] = useState(first);
  const [sector, setSector] = useState("");
  const [level, setLevel] = useState<"LOW" | "NORMAL" | "HIGH">("HIGH");
  const [repeat, setRepeat] = useState(false), [weekdays, setWeekdays] = useState<number[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const feedbackId = useId();
  const priorities = input.movementPriorities ?? [];
  const sectors = [...new Set(input.employees.map(person => person.sector))].filter(Boolean).sort(compareSectors);
  const labels = { LOW: "Menor movimento", NORMAL: "Movimento habitual", HIGH: "Maior movimento" };
  const weekLabels = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  function update(next: NonNullable<EscalaInput["movementPriorities"]>, message: string) {
    onChange({ ...input, movementPriorities: next, ...(input.assignments.length ? { needsRegeneration: true } : {}) });
    setNotice(message); setError("");
  }
  function add(event: React.FormEvent) {
    event.preventDefault(); if (disabled) return;
    const result = addMovementSelection(input, { startDate, endDate, level, ...(sector ? { sector } : {}), ...(repeat ? { weekdays } : {}) });
    if (!result.ok) { setError(result.error); setNotice(""); return; }
    update(result.priorities, `Indicação incluída para ${result.dates} dia(s) no rascunho. Salve e gere novamente para aplicar ao planejamento.`);
  }
  return <details className="space-y-3">
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">Movimento da loja (opcional){priorities.length ? ` · ${priorities.length} indicação(ões)` : ""}</summary>
    <p className="text-sm text-[color:var(--app-muted)]">Informe os dias mais ou menos movimentados de cada setor, conforme sua operação. O algoritmo prioriza a presença da equipe e dos responsáveis nos dias informados, sem garantir atendimento nem criar mínimos obrigatórios. Sem informação, não presume movimento maior no fim de semana.</p>
    <form onSubmit={add} aria-describedby={feedbackId}>
      <fieldset disabled={disabled} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Qual setor?">{id => <select id={id} className={controlClass} value={sector} onChange={event => setSector(event.target.value)}><option value="">Toda a filial</option>{sectors.map(item => <option key={item} value={item}>{item}</option>)}</select>}</Field>
          <Field label="Movimento esperado">{id => <select id={id} className={controlClass} value={level} onChange={event => setLevel(event.target.value as typeof level)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}</Field>
          <Field label="A partir de">{id => <input id={id} className={controlClass} type="date" required min={input.startDate} max={input.endDate} value={startDate} onChange={event => setStart(event.target.value)} />}</Field>
          <Field label="Até">{id => <input id={id} className={controlClass} type="date" required min={startDate} max={input.endDate} value={endDate} onChange={event => setEnd(event.target.value)} />}</Field>
        </div>
        <Check label="Repetir em dias da semana" checked={repeat} onChange={checked => { setRepeat(checked); if (checked && startDate === endDate) setEnd(last); }} />
        {repeat && <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Quais dias desse período?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{weekLabels.map((label, day) => <Check key={label} label={label} checked={weekdays.includes(day)}
            onChange={checked => setWeekdays(current => checked ? [...current, day] : current.filter(value => value !== day))} />)}</div>
          <p className="text-xs text-[color:var(--app-muted)]">Marque somente os dias conhecidos. Nenhum dia é selecionado automaticamente.</p>
        </fieldset>}
        <button type="submit" className={buttonClass}>Acrescentar indicação</button>
      </fieldset>
    </form>
    <div id={feedbackId}>{error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}</div>
    {priorities.length > 0 && <ul className="max-h-64 space-y-2 overflow-y-auto text-sm" aria-label="Movimento informado por setor e data">
      {movementRows(priorities).map(({ priority, index }) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--app-border)] py-2">
        <span className="min-w-0 break-words"><strong className="font-medium">{priority.sector || "Toda a filial"}</strong> · {displayDate(priority.startDate)}{priority.endDate !== priority.startDate ? `–${displayDate(priority.endDate)}` : ""} · {labels[priority.level]}</span>
        <button type="button" className={buttonClass} disabled={disabled} aria-label={`Remover indicação de ${priority.sector || "toda a filial"} em ${displayDate(priority.startDate)}`} onClick={() => update(
          priorities.filter((_, position) => position !== index), "Indicação removida do rascunho. Salve e gere novamente para atualizar o planejamento.")}>Remover</button>
      </li>)}
    </ul>}
    {priorities.length > 0 && <p className="text-xs text-[color:var(--app-muted)]">Nas mesmas datas, o movimento do setor prevalece sobre o da filial. A indicação orienta a distribuição da equipe, não representa demanda de pessoal medida. Alterações exigem nova geração.</p>}
  </details>;
}
