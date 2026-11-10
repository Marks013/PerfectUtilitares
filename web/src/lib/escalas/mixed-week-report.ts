import { addDays, dayOfWeek, visibleDates, weekStart } from "./dates";
import { usesMixed42Week } from "./labor-rules";
import type { EscalaEmployee, EscalaInput } from "./types";

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dayMonth = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;

/** Display only the actual visible dates using this variant; absence and padding are never invented work. */
export function mixedWeeklyApplication(input: EscalaInput, employee: EscalaEmployee, dates: string[]): string {
  if (!visibleDates(input).some(date => usesMixed42Week(input, employee, date))) return "";
  const weeks = new Map<string, string[]>();
  for (const date of [...new Set(dates)].sort()) {
    const monday = weekStart(date);
    const actual = weeks.get(monday) ?? [];
    actual.push(date); weeks.set(monday, actual);
  }
  return [...weeks].map(([monday, actual]) => {
    const days = actual.map(date => `${weekdays[dayOfWeek(date)]} ${date.slice(8)}`).join(", ");
    return `${dayMonth(monday)}–${dayMonth(addDays(monday, 6))}: ${actual.length} ${actual.length === 1 ? "dia" : "dias"} · ${days}`;
  }).join("\n");
}
