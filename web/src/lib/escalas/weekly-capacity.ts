import { dateRange } from "./dates";
import { isRestPlanningExcludedRole } from "./eligibility";
import { effectiveWeeklyHours } from "./labor-rules";
import { compareSectors } from "./order";
import { planningWeeklyHours } from "./preparation";
import type { EscalaInput, WeeklyHours } from "./types";

export type WeeklySectorCapacity = {
  sector: string;
  people: number;
  untimedPeople: number;
  shortReferencePeople: number;
  referenceHours: number;
  hours42: number;
  hours40: number;
  currentHours: number;
  currentHoursMax: number;
  scenarioWeeklyHours: WeeklyHours;
  missingHours: number;
  equivalentPeople: number;
  additionalEquivalentPeople: number;
};

export const weeklyCapacityCaveat = "Comparação nominal, antes de afastamentos, feriados e disponibilidade no mês. Não comprova cobertura nem indica contratação.";
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** A hypothetical 44h baseline compares capacity; it is not an imported contract or authorization. */
export function weeklySectorCapacity(input: EscalaInput): WeeklySectorCapacity[] {
  const weeks = dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0);
  if (!weeks.length) return [];
  const scenarioWeeklyHours = Math.min(...weeks.map(week => effectiveWeeklyHours({ weeklyHours: input.defaultWeeklyHours }, week))) as WeeklyHours;
  const shifts = new Set(input.shifts.map(shift => shift.id));
  const sectors = new Map<string, { row: WeeklySectorCapacity; current: number[] }>();
  for (const person of input.employees) {
    if (person.planningEnabled === false || isRestPlanningExcludedRole(person.role) || person.activeFrom > input.endDate
      || person.activeUntil && person.activeUntil < input.startDate) continue;
    let sector = sectors.get(person.sector);
    if (!sector) {
      sector = { row: { sector: person.sector, people: 0, untimedPeople: 0, shortReferencePeople: 0,
        referenceHours: 0, hours42: 0, hours40: 0, currentHours: 0, currentHoursMax: 0, scenarioWeeklyHours,
        missingHours: 0, equivalentPeople: 0, additionalEquivalentPeople: 0 }, current: weeks.map(() => 0) };
      sectors.set(person.sector, sector);
    }
    const { row, current } = sector;
    if (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING" || !person.shiftIds.some(id => shifts.has(id))) {
      row.untimedPeople++;
      continue;
    }
    // A short civil reference does not reveal a full weekly contract. Do not turn it into 44h of capacity.
    if (person.simulationDailyMinutes !== undefined) {
      row.shortReferencePeople++;
      continue;
    }
    row.people++;
    const hypothetical = (hours: WeeklyHours) => person.weeklyHoursMode === "INDIVIDUAL" ? Math.min(person.weeklyHours, hours) : hours;
    row.referenceHours += hypothetical(44);
    row.hours42 += hypothetical(42);
    row.hours40 += hypothetical(40);
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
    weeks.forEach((week, index) => { current[index] += effectiveWeeklyHours(reference, week); });
  }
  return [...sectors.values()].map(({ row, current }) => {
    row.currentHours = Math.min(...current);
    row.currentHoursMax = Math.max(...current);
    row.missingHours = Math.max(0, row.referenceHours - row.currentHours);
    row.equivalentPeople = row.referenceHours / row.scenarioWeeklyHours;
    row.additionalEquivalentPeople = row.missingHours / row.scenarioWeeklyHours;
    return row;
  }).sort((a, b) => compareSectors(a.sector, b.sector));
}

/** Shared wording prevents UI and exports from labeling a fractional equivalent as hours or hiring. */
export function weeklyCapacityText(row: WeeklySectorCapacity): string {
  const excluded = [row.untimedPeople ? `${row.untimedPeople} sem horário apurado` : "",
    row.shortReferencePeople ? `${row.shortReferencePeople} com referência curta sem carga semanal confirmada` : ""].filter(Boolean);
  if (!row.people) return `Capacidade semanal não apurada${excluded.length ? ": " + excluded.join("; ") : "."}`;
  const current = row.currentHours === row.currentHoursMax ? number.format(row.currentHours) : `${number.format(row.currentHours)}–${number.format(row.currentHoursMax)}`;
  const parts = [`${row.people} colaborador(es) com horário`, `Referência 44h: ${number.format(row.referenceHours)}h/semana`,
    `42h: ${number.format(row.hours42)}h`, `40h: ${number.format(row.hours40)}h`, `Atual: ${current}h/semana`];
  if (row.missingHours) parts.push(`${row.currentHours !== row.currentHoursMax ? "Até " : ""}${number.format(row.missingHours)}h a menos que a referência`,
    `Equivalência da referência em ${row.scenarioWeeklyHours}h: ${number.format(row.equivalentPeople)} pessoas (+${number.format(row.additionalEquivalentPeople)} equivalente)`);
  if (excluded.length) parts.push(`Fora desta conta: ${excluded.join("; ")}`);
  return parts.join(" · ") + ".";
}
