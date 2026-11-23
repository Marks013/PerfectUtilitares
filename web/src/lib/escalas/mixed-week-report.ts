import { dayOfWeek, visibleDates, weekStart } from "./dates";
import { planningWeekEnd } from "./planning-calendar";
import { usesMixed42Week } from "./labor-rules";
import type { EscalaEmployee, EscalaInput } from "./types";

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dayMonth = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;

/** Display only the actual visible dates using this variant; absence and padding are never invented work. */
export function mixedWeeklyApplication(input: EscalaInput, employee: EscalaEmployee, dates: string[]): string {
  if (!visibleDates(input).some(date => usesMixed42Week(input, employee, date))) return "";
  const weeks = new Map<string, string[]>();
  for (const date of [...new Set(dates)].sort()) {
    const start = weekStart(date, input);
    const actual = weeks.get(start) ?? [];
    actual.push(date); weeks.set(start, actual);
  }
  return [...weeks].map(([start, actual]) => {
    const days = actual.map(date => `${weekdays[dayOfWeek(date)]} ${date.slice(8)}`).join(", ");
    return `${dayMonth(start)}–${dayMonth(planningWeekEnd(start, input))}: ${actual.length} ${actual.length === 1 ? "dia" : "dias"} · ${days}`;
  }).join("\n");
}
