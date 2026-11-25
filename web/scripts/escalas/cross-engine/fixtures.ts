/** Synthetic inputs only. No CSV, workspace, DB, or caller-supplied model. */
import { newEmployee, newInput } from "../../../src/components/escalas/workspace-model";
import { prepareGeneration } from "../../../src/lib/escalas/generation";
import { dateRange } from "../../../src/lib/escalas/dates";
import { escalaInputSchema } from "../../../src/lib/escalas/schema";
import { generationScenarioBasis } from "../../../src/lib/escalas/hours-reference";
import type { EscalaInput } from "../../../src/lib/escalas/types";
import { syntheticInput } from "../benchmark-synthetic";

export const scenarioIds = ["team-10-week", "branch-50-four-weeks", "branch-115-six-weeks",
  "branch-115-six-weeks-untimed", "december-representative", "hours-reference-only",
  "hours-only-with-grid", "stress-250-six-weeks", "december-protected"] as const;
export type ScenarioId = typeof scenarioIds[number];
export type Scenario = { id: ScenarioId; prepared: EscalaInput; reference?: EscalaInput; admittedDecemberOrigin?: EscalaInput };

function prepare(raw: EscalaInput): EscalaInput {
  const input = escalaInputSchema.parse(prepareGeneration(raw).input);
  return { ...input, needsRegeneration: false, generationBasis: generationScenarioBasis(input) };
}

/** Deliberately generated aggregates, not a reconstruction of the actual Hipermercado. */
function december(): EscalaInput {
  const raw = newInput("SYNTH", "Synthetic December", "2026-12", 42);
  raw.generationMode = "DAYS_AND_HOURS";
  raw.policy = { ...raw.policy, calendarMode: "MANUAL", holidayDates: ["2026-12-25"],
    closedDates: ["2026-12-25"], limitContinuousWorkBlocks: false };
  const starts = [390, 435, 465, 510, 555, 580];
  raw.shifts = starts.map((start, index) => ({
    id: "synthetic-clock-" + index, name: "Synthetic clock " + index,
    segments: [{ start, end: start + 240, kind: "WORK" },
      { start: start + 240, end: start + 300, kind: "BREAK" },
      { start: start + 300, end: start + 564, kind: "WORK" }],
  }));
  raw.employees = Array.from({ length: 140 }, (_, i) => {
    const untimed = i >= 110 && i < 125;
    const excluded = i >= 125 && i < 135;
    const administrative = i >= 135;
    return {
      ...newEmployee(42, untimed ? undefined : raw.shifts[i % starts.length].id),
      id: "synthetic-" + i, registration: "S" + i, name: "Synthetic person " + i,
      sector: administrative ? "AFASTADOS" : "Synthetic sector " + (i % 10),
      role: untimed ? "Encarregado" : excluded ? "Jovem aprendiz" : i % 3 === 0 ? "Caixa" : "Repositor",
      scheduleMode: untimed ? "UNTIMED" as const : "TIMED" as const,
      planningEnabled: !excluded,
    };
  });
  return prepare(raw);
}

export function makeScenario(id: ScenarioId): Scenario {
  if (id === "december-representative") return { id, prepared: december() };
  if (id === "december-protected") {
    // Reproduce the admitted-reference edge from the current client regression, not a real saved roster.
    const prepared = makeScenario("team-10-week").prepared;
    const person = { ...prepared.employees[0], activeFrom: "2026-12-01" };
    const origin: EscalaInput = { ...prepared, startDate: "2026-12-01", endDate: "2026-12-31",
      planningWeekStartsOn: "SUNDAY", visibleMonth: "2026-12", needsRegeneration: true,
      coverageBasis: "coverage-v2:aaaaaaaaaaaaaaaa",
      employees: [person], assignments: dateRange("2026-12-01", "2026-12-31").map(date => ({
        employeeId: person.id, date, kind: "WORK", shiftId: person.shiftIds[0],
      })), demands: [{ id: "synthetic-origin-demand", date: "2026-12-07", sector: person.sector,
        role: person.role, start: 480, end: 540, minimum: 1, estimated: true }] };
    // Historical reference intentionally need not be reusable; the app validates comparability and protects service.
    return { id, prepared: { ...origin, assignments: [] }, reference: origin, admittedDecemberOrigin: origin };
  }
  const sizes = { "team-10-week": [10, 1], "branch-50-four-weeks": [50, 4],
    "branch-115-six-weeks": [115, 6], "branch-115-six-weeks-untimed": [115, 6],
    "stress-250-six-weeks": [250, 6], "hours-reference-only": [10, 1], "hours-only-with-grid": [10, 1] } as const;
  const [people, weeks] = sizes[id];
  const input = syntheticInput({ id, people, weeks, untimedLeaders: id === "branch-115-six-weeks-untimed" });
  if (id === "hours-reference-only") return { id, prepared: prepare({ ...input, generationMode: "HOURS_ONLY" }) };
  if (id === "hours-only-with-grid") {
    const assignments: EscalaInput["assignments"] = input.employees.flatMap(person =>
      dateRange(input.startDate, input.endDate).map((date, day) => {
        // Distinct legal five-day patterns; never give Saturday off in the fixture.
        const off = day === (Number(person.registration) % 2 === 0 ? 0 : 1) || day === 3;
        return { employeeId: person.id, date, locked: false,
          ...(off ? { kind: "OFF" as const } : { kind: "WORK" as const, shiftId: person.shiftIds[0] }) };
      }));
    const prepared = prepare({ ...input, generationMode: "HOURS_ONLY", assignments });
    return { id, prepared, reference: structuredClone(prepared) };
  }
  return { id, prepared: input };
}
