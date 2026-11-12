import { dateRange, dayOfWeek, isDate } from "@/lib/escalas/dates";
import { compareSectors } from "@/lib/escalas/order";
import type { EscalaInput } from "@/lib/escalas/types";

type Priority = NonNullable<EscalaInput["movementPriorities"]>[number];
export type MovementSelection = Priority & { weekdays?: number[] };
type SelectionResult = { ok: true; priorities: Priority[]; dates: number } | { ok: false; error: string };

/** Expand only dates explicitly selected by the operator; no presumed peak or staffing minimum. */
export function addMovementSelection(input: EscalaInput, selection: MovementSelection): SelectionResult {
  const { startDate, endDate, sector, level, weekdays } = selection;
  if (!isDate(startDate) || !isDate(endDate) || startDate < input.startDate || endDate > input.endDate || endDate < startDate)
    return { ok: false, error: "Escolha datas dentro do planejamento, com término igual ou posterior ao início." };
  if (weekdays && (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)))
    return { ok: false, error: "Marque ao menos um dia da semana para repetir a indicação." };
  const dates = dateRange(startDate, endDate).filter(date => !weekdays || weekdays.includes(dayOfWeek(date)));
  if (!dates.length) return { ok: false, error: "Os dias escolhidos não aparecem nesse período. Altere as datas ou os dias da semana." };
  const existing = input.movementPriorities ?? [];
  const additions: Priority[] = weekdays
    ? dates.map(date => ({ startDate: date, endDate: date, level, ...(sector ? { sector } : {}) }))
    : [{ startDate, endDate, level, ...(sector ? { sector } : {}) }];
  if (existing.length + additions.length > 250)
    return { ok: false, error: "O limite é de 250 indicações. Remova uma indicação anterior ou escolha um período menor." };
  const conflicts = additions.filter(next => existing.some(item => (item.sector ?? "") === (sector ?? "")
    && item.startDate <= next.endDate && next.startDate <= item.endDate));
  if (conflicts.length)
    return { ok: false, error: "Já há uma indicação para essas datas e esse setor. Confira a lista abaixo: remova a indicação anterior ou escolha outras datas. Nenhuma indicação foi alterada." };
  return { ok: true, priorities: [...existing, ...additions], dates: dates.length };
}

/** Display order must not change stored priority precedence or removal identity. */
export function movementRows(priorities: Priority[]) {
  return priorities.map((priority, index) => ({ priority, index })).sort((a, b) =>
    compareSectors(a.priority.sector ?? "", b.priority.sector ?? "")
    || a.priority.startDate.localeCompare(b.priority.startDate)
    || a.priority.endDate.localeCompare(b.priority.endDate)
    || a.index - b.index);
}
