import { weeklyCapacityText, type WeeklySectorCapacity } from "@/lib/escalas/weekly-capacity";

export function WeeklyCapacity({ capacity }: { capacity: WeeklySectorCapacity | undefined }) {
  if (!capacity) return null;
  return <section className="space-y-1" aria-label="Capacidade semanal nominal">
    <p className="text-sm font-semibold">Capacidade semanal nominal</p>
    <p className="text-sm tabular-nums">{weeklyCapacityText(capacity)}</p>
  </section>;
}
