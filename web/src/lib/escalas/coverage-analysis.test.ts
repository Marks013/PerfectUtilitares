import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { coverageBasis } from "./automatic-coverage";
import { analyzeCoverage } from "./coverage-analysis";
import type { EscalaEmployee, EscalaInput } from "./types";

const day = "2026-11-02";
function person(id: string, role = "Repositor"): EscalaEmployee {
  return { id, name: id, registration: id, sector: "Reposição", role, weeklyHours: 42, weeklyHoursMode: "BRANCH",
    activeFrom: "", shiftIds: ["work"], scheduleMode: "TIMED", planningEnabled: true, offMode: "VARIABLE", fixedOffDays: [],
    preferredOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, historyKnown: false, history: [] };
}
function fixture(count = 1): EscalaInput {
  const input = newInput("06", "Filial", "2026-11", 42);
  input.startDate = day; input.endDate = day; input.visibleMonth = undefined;
  input.policy.closedDates = []; input.policy.holidayDates = []; input.policy.authorizedHolidayDates = [];
  input.employees = Array.from({ length: count }, (_, index) => person(String(index)));
  input.shifts = [{ id: "work", name: "Horário conhecido", segments: [{ start: 540, end: 600, kind: "WORK" }] }];
  input.assignments = input.employees.map(employee => ({ employeeId: employee.id, date: day, kind: "WORK", shiftId: "work" }));
  input.demands = [{ id: "need", date: day, sector: "Reposição", role: "Repositor", start: 540, end: 600, minimum: 1 }];
  return input;
}
const sector = (input: EscalaInput, candidate = input) => analyzeCoverage(input, candidate).sectors[0];

describe("derived coverage analysis", () => {
  it("integrates partial presence and keeps simultaneous peaks separate from person-minutes", () => {
    const input = fixture(2);
    input.shifts.push({ id: "partial", name: "Parcial", segments: [{ start: 570, end: 600, kind: "WORK" }] });
    input.assignments[1].shiftId = "partial"; input.demands[0].minimum = 2;
    const result = analyzeCoverage(input, input, { details: true });
    expect(result.sectors[0]).toMatchObject({ knownWorkPersonMinutes: 90, availablePersonMinutes: 90,
      confirmed: { requiredPersonMinutes: 120, coveredPersonMinutes: 90, deficitPersonMinutes: 30, peakMissing: 1 } });
    expect(result.sectors[0].details?.map(row => [row.start, row.end, row.presentKnown])).toEqual([[540, 570, 1], [570, 600, 2]]);
    expect(analyzeCoverage(input, input).sectors[0]).not.toHaveProperty("details");
  });
  it("credits PAID_BREAK without counting service during the paid pause", () => {
    const input = fixture();
    input.shifts[0].segments = [{ start: 540, end: 560, kind: "WORK" }, { start: 560, end: 580, kind: "PAID_BREAK" }, { start: 580, end: 600, kind: "WORK" }];
    expect(sector(input)).toMatchObject({ knownWorkPersonMinutes: 40, creditedPersonMinutes: 60,
      confirmed: { deficitPersonMinutes: 20, peakMissing: 1 } });
  });
  it("counts duplicate assignments, overlapping segments and repeated function references once", () => {
    const input = fixture();
    input.assignments.push({ ...input.assignments[0] });
    input.shifts[0].segments.push({ start: 570, end: 630, kind: "WORK" });
    input.demands[0].end = 630; input.demands.push({ ...input.demands[0], id: "duplicate" });
    expect(sector(input)).toMatchObject({ knownWorkPersonMinutes: 90, creditedPersonMinutes: 90,
      confirmed: { requiredPersonMinutes: 90, deficitPersonMinutes: 0, peakMissing: 0 } });
  });
  it("sums distinct function deficits without letting a different role substitute or adding the sector deficit twice", () => {
    const input = fixture(2); input.employees[1].role = "Outra função";
    input.demands = [{ ...input.demands[0], minimum: 2 }, { ...input.demands[0], id: "other", role: "Padeiro", minimum: 1 },
      { ...input.demands[0], id: "general", role: undefined, minimum: 2 }];
    expect(sector(input).confirmed).toMatchObject({ requiredPersonMinutes: 180, deficitPersonMinutes: 120, peakMissing: 2, peakSectorMissing: 1 });
  });
  it("subtracts OFF, ABSENCE and ordinary breaks while keeping nominal capacity separate", () => {
    const input = fixture(3);
    input.assignments[1] = { employeeId: "1", date: day, kind: "OFF" };
    input.assignments[2] = { employeeId: "2", date: day, kind: "ABSENCE" };
    input.shifts[0].segments = [{ start: 540, end: 560, kind: "WORK" }, { start: 560, end: 580, kind: "BREAK" }, { start: 580, end: 600, kind: "WORK" }];
    const result = analyzeCoverage(input, input);
    expect(result.sectors[0]).toMatchObject({ availablePersonMinutes: 40, creditedPersonMinutes: 40, confirmed: { deficitPersonMinutes: 20 } });
    expect(result.cohort.comparablePeople).toBe(3);
  });
  it("reports ENC/MISSING separately without invalidating the known TIMED cohort", () => {
    const input = fixture(2); input.employees[1] = { ...person("1", "ENC"), scheduleMode: "MISSING", shiftIds: [] };
    input.assignments[1] = { employeeId: "1", date: day, kind: "DUTY" };
    const result = analyzeCoverage(input, input);
    expect(result.sectors[0]).toMatchObject({ scope: "TIMED_WORK", status: "READY", knownWorkPersonMinutes: 60, availablePersonMinutes: 60,
      withoutClockPeople: 1, withoutClockPersonDays: 1, unknownPersonDays: 0,
      confirmed: { requiredPersonMinutes: 60, deficitPersonMinutes: 0, peakMissing: 0 } });
    expect(result.cohort).toMatchObject({ comparablePeople: 1, excludedByReason: { UNKNOWN_CLOCK: 1 } });
  });
  it("keeps malformed TIMED WORK partial instead of treating its clock as known zero", () => {
    const input = fixture(2); input.assignments[1].shiftId = "missing";
    expect(sector(input)).toMatchObject({ status: "PARTIAL", unknownPersonDays: 1, withoutClockPeople: 0,
      availablePersonMinutes: null, confirmed: { deficitPersonMinutes: null, peakMissing: null } });
  });
  it("keeps intentional UNTIMED DUTY informational even when its unused shift reference is present", () => {
    const input = fixture(2); input.employees[1].scheduleMode = "UNTIMED";
    input.assignments[1] = { employeeId: "1", date: day, kind: "DUTY" };
    expect(sector(input)).toMatchObject({ status: "READY", availablePersonMinutes: 60, withoutClockPeople: 1, confirmed: { deficitPersonMinutes: 0 } });
  });
  it("keeps intentional DUTY outside the timed index even with an overnight historical clock", () => {
    const input = fixture(2); input.demands[0].minimum = 2;
    input.shifts.push({ id: "overnight", name: "Contexto conhecido", segments: [{ start: 1320, end: 2040, kind: "WORK" }] });
    input.employees[1].history = [{ employeeId: "1", date: "2026-11-01", kind: "WORK", shiftId: "overnight" }];
    input.assignments[1] = { employeeId: "1", date: day, kind: "DUTY" };
    expect(sector(input)).toMatchObject({ status: "READY", availablePersonMinutes: 60, creditedPersonMinutes: 60,
      withoutClockPeople: 1, confirmed: { deficitPersonMinutes: 60, peakMissing: 1 } });
  });
  it("reports a missing roster as unknown rather than zero deficit", () => {
    const input = fixture(), candidate = structuredClone(input); candidate.assignments = [];
    expect(sector(input, candidate)).toMatchObject({ status: "PARTIAL", availablePersonMinutes: null, confirmed: { deficitPersonMinutes: null } });
    expect(analyzeCoverage(input, { ...candidate, generationMode: "HOURS_ONLY" })).toMatchObject({ status: "UNAVAILABLE", sectors: [] });
  });
  it("freezes the prepared target across candidates and validates the stored estimation basis", () => {
    const input = fixture(); input.demands[0].estimated = true; input.coverageBasis = coverageBasis(input);
    const candidate = structuredClone(input); candidate.assignments[0] = { employeeId: "0", date: day, kind: "OFF" }; candidate.demands = [];
    const before = structuredClone(input), result = analyzeCoverage(input, candidate);
    expect(result.basis.status).toBe("VALID");
    expect(result.sectors[0].estimated).toMatchObject({ requiredPersonMinutes: 60, deficitPersonMinutes: 60, peakMissing: 1 });
    expect(input).toEqual(before);
    const stale = { ...input, defaultWeeklyHours: 40 as const };
    expect(analyzeCoverage(stale, candidate).sectors[0].estimated).toMatchObject({ requiredPersonMinutes: 60, deficitPersonMinutes: null });
    expect(analyzeCoverage(stale, candidate).basis.status).toBe("STALE");
  });
  it("separates confirmed and estimated references to the same function", () => {
    const input = fixture(); input.demands.push({ ...input.demands[0], id: "estimate", estimated: true, minimum: 3 });
    input.coverageBasis = coverageBasis(input);
    expect(sector(input)).toMatchObject({ confirmed: { deficitPersonMinutes: 0 }, estimated: { deficitPersonMinutes: 120, peakMissing: 2 } });
  });
  it("adds person-minutes but never adds peaks across dates or disjoint windows", () => {
    const input = fixture(); input.endDate = "2026-11-03"; input.demands[0].minimum = 2;
    input.assignments.push({ ...input.assignments[0], date: input.endDate });
    input.demands.push({ ...input.demands[0], id: "tomorrow", date: input.endDate });
    expect(sector(input).confirmed).toMatchObject({ deficitPersonMinutes: 120, peakMissing: 1 });
  });
  it("compares 44→42/40 using the same eligible population and expresses equivalents in people", () => {
    const input = fixture(10);
    input.employees.push({ ...person("apprentice", "APRENDIZ") }, { ...person("enc", "ENC"), scheduleMode: "UNTIMED", shiftIds: [] },
      { ...person("short"), simulationDailyMinutes: 300 }, { ...person("short-fpre"), sourceSchedule: { report: "FPRE136", code: "known", description: "Referência curta",
        weekday: "08:00 - 13:00", saturday: "08:00 - 12:00" } });
    const result = analyzeCoverage(input, input, { nominalReferenceWeeklyHours: 44, nominalReferenceOrigin: "HYPOTHETICAL" });
    expect(result.cohort.comparablePeople).toBe(10);
    expect(result.nominal).toMatchObject({ origin: "HYPOTHETICAL", referenceCapacityHours: 440, candidateWeeklyHoursMin: 420 });
    expect(result.nominal.scenarios[0]).toMatchObject({ weeklyHours: 42, capacityHours: 420, lostHours: 20 });
    expect(result.nominal.scenarios[0].additionalEquivalentPeople).toBeCloseTo(20 / 42);
    expect(result.nominal.scenarios[1]).toMatchObject({ weeklyHours: 40, capacityHours: 400, lostHours: 40, equivalentPeople: 11, additionalEquivalentPeople: 1 });
  });
  it("does not inflate an individual 40h reference into a hypothetical 44h loss", () => {
    const input = fixture(); input.employees[0].weeklyHours = 40; input.employees[0].weeklyHoursMode = "INDIVIDUAL";
    const result = analyzeCoverage(input, input);
    expect(result.nominal.referenceCapacityHours).toBe(40);
    expect(result.nominal.scenarios.map(row => row.lostHours)).toEqual([0, 0]);
  });
  it("keeps known original Saturday 4h separate from target, candidate and previous roster", () => {
    const input = fixture(); input.startDate = input.endDate = "2026-11-07";
    input.assignments[0].date = input.startDate; input.demands[0].date = input.startDate;
    input.shifts[0].segments = [{ start: 480, end: 960, kind: "WORK" }];
    input.demands[0].start = 480; input.demands[0].end = 960;
    const original = structuredClone(input); original.shifts[0].segments[0].end = 720;
    const result = analyzeCoverage(input, input, { originalInput: original });
    expect(result.sectors[0].knownWorkPersonMinutes).toBe(480);
    expect(result.originalAvailability?.[0].knownWorkPersonMinutes).toBe(240);
    expect(result.previous.status).toBe("NOT_PROVIDED");
    expect(analyzeCoverage(input, input).originalAvailability).toBeNull();
  });
  it("refuses before/after claims when targets, rules or the known roster changed", () => {
    const input = fixture(), previous = structuredClone(input);
    expect(analyzeCoverage(input, input, { previousInput: previous }).previous.status).toBe("COMPARABLE");
    previous.demands[0].minimum = 2;
    expect(analyzeCoverage(input, input, { previousInput: previous }).previous.status).toBe("NOT_COMPARABLE");
    const changed = structuredClone(input); changed.policy.minInterShiftMinutes++;
    expect(analyzeCoverage(input, changed, { previousInput: input }).previous.status).toBe("NOT_COMPARABLE");
    expect(analyzeCoverage(input, input, { previousInput: { ...input, assignments: [] } }).previous.status).toBe("NOT_COMPARABLE");
  });
  it("uses only common dates and returns null nominal values for an empty comparable cohort", () => {
    const input = fixture(), result = analyzeCoverage(input, input, { dates: [day, "2026-11-03"], comparableEmployeeIds: ["missing"] });
    expect(result.dates).toEqual([day]); expect(result.omittedDates).toEqual(["2026-11-03"]);
    expect(result.nominal.referenceCapacityHours).toBeNull();
    expect(result.nominal.scenarios.every(row => row.additionalEquivalentPeople === null)).toBe(true);
  });
  it("preserves fixed after-closing references and flags their origin instead of silently removing a deficit", () => {
    const input = fixture(); input.shifts[0].segments = [{ start: 1200, end: 1260, kind: "WORK" }];
    input.demands[0].start = 1200; input.demands[0].end = 1260; input.demands[0].minimum = 2;
    const result = analyzeCoverage(input, input);
    expect(result.limitations).toContain("REFERENCE_AFTER_STORE_CLOSING");
    expect(result.sectors[0].confirmed).toMatchObject({ deficitPersonMinutes: 60, peakMissing: 1 });
  });
  it("infers 8h weekdays plus an explicit 4h Saturday as 44h, without claiming a contract", () => {
    const input = fixture(); input.employees[0].sourceSchedule = { report: "FPRE136", code: "original", description: "Importado",
      weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" };
    const result = analyzeCoverage(input, input).nominal;
    expect(result).toMatchObject({ origin: "FPRE136_INFERRED", referenceWeeklyHours: 44, referenceCapacityHours: 44,
      referencePeople: 1, withoutReferencePeople: 0 });
    expect(result.scenarios.map(row => row.lostHours)).toEqual([2, 4]);
  });
  it("keeps mixed imported references and the unknown-origin population separate", () => {
    const input = fixture(3);
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "a", description: "Importado",
      weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00" };
    input.employees[1].sourceSchedule = { report: "FPRE136", code: "b", description: "Importado",
      weekday: "06:00-12:00", saturday: "08:00-12:00" };
    const result = analyzeCoverage(input, input).nominal;
    expect(result).toMatchObject({ origin: "MIXED", referenceWeeklyHours: null, referenceCapacityHours: 78,
      referencePeople: 2, withoutReferencePeople: 1, preparedWeeklyHoursMin: 84 });
    expect(result.sourceGroups.map(group => [group.weeklyHours, group.people])).toEqual([[34, 1], [44, 1]]);
    expect(result.scenarios.map(row => [row.capacityHours, row.lostHours])).toEqual([[76, 2], [74, 4]]);
  });
  it("does not assume Saturday or a 44h origin when imported information is absent", () => {
    const input = fixture();
    expect(analyzeCoverage(input, input).nominal).toMatchObject({ origin: "UNAVAILABLE", referenceCapacityHours: null, referencePeople: 0, withoutReferencePeople: 1 });
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "a", description: "Importado", weekday: "08:00-12:00 / 13:00-17:00", saturday: "" };
    expect(analyzeCoverage(input, input).nominal.referenceCapacityHours).toBeNull();
    input.employees[0].sourceSchedule = { ...input.employees[0].sourceSchedule, weekday: "06:00-12:00", saturday: "00:00-00:00 / 00:00-00:00" };
    expect(analyzeCoverage(input, input).nominal).toMatchObject({ origin: "FPRE136_INFERRED", referenceCapacityHours: 30 });
  });
  it("preserves an explicit individual 44h setting in branch 42/40 scenarios", () => {
    const input = fixture(); input.employees[0].weeklyHours = 44; input.employees[0].weeklyHoursMode = "INDIVIDUAL";
    const result = analyzeCoverage(input, input).nominal;
    expect(result).toMatchObject({ origin: "CONFIGURED_INDIVIDUAL", referenceCapacityHours: 44 });
    expect(result.scenarios.map(row => [row.capacityHours, row.lostHours])).toEqual([[44, 0], [44, 0]]);
  });
  it("uses the shared HOURS_ONLY classifier for absence/holiday-only references", () => {
    const input = fixture(2); input.generationMode = "HOURS_ONLY";
    input.assignments[0] = { employeeId: "0", date: day, kind: "ABSENCE" };
    input.assignments[1] = { employeeId: "1", date: day, kind: "HOLIDAY" };
    expect(analyzeCoverage(input, input)).toMatchObject({ status: "UNAVAILABLE", sectors: [] });
  });
  it("orders displayed sectors and functions in pt-BR without merging different labels", () => {
    const input = fixture(4), labels = ["ALMOXARIFADO", "AÇOUGUE", "área", "ÁREA"];
    input.employees.forEach((employee, index) => { employee.sector = labels[index]; });
    input.demands = labels.map((label, index) => ({ ...input.demands[0], id: String(index), sector: label }));
    const sectors = analyzeCoverage(input, input).sectors.map(row => row.sector);
    expect(sectors.slice(0, 2)).toEqual(["AÇOUGUE", "ALMOXARIFADO"]);
    expect(new Set(sectors)).toEqual(new Set(labels)); expect(sectors).toHaveLength(4);
    const functions = fixture(3), roles = ["Árvore", "ALMOX", "Açougueiro"];
    functions.employees.forEach((employee, index) => { employee.role = roles[index]; });
    functions.demands = roles.map((role, index) => ({ ...functions.demands[0], id: String(index), role }));
    expect(analyzeCoverage(functions, functions, { details: true }).sectors[0].details?.[0].confirmed?.roles.map(row => row.role))
      .toEqual(["Açougueiro", "ALMOX", "Árvore"]);
  });
  it("calculates each sector's nominal comparison on its own known cohort using the global helper", () => {
    const input = fixture(3); input.employees[0].sector = "Açougue";
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "a", description: "Importado",
      weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00" };
    input.employees[1].sector = "Padaria"; input.employees[1].weeklyHours = 44; input.employees[1].weeklyHoursMode = "INDIVIDUAL";
    input.employees[2].sector = "Sem origem";
    input.demands = input.employees.map((employee, index) => ({ ...input.demands[0], id: String(index), sector: employee.sector }));
    const result = analyzeCoverage(input, input), bySector = new Map(result.sectors.map(row => [row.sector, row.nominal]));
    expect(bySector.get("Açougue")).toMatchObject({ origin: "FPRE136_INFERRED", referenceCapacityHours: 44, referencePeople: 1, withoutReferencePeople: 0 });
    expect(bySector.get("Padaria")).toMatchObject({ origin: "CONFIGURED_INDIVIDUAL", referenceCapacityHours: 44 });
    expect(bySector.get("Açougue")?.scenarios[0]).toMatchObject({ capacityHours: 42, lostHours: 2 });
    expect(bySector.get("Padaria")?.scenarios[0]).toMatchObject({ capacityHours: 44, lostHours: 0 });
    expect(bySector.get("Sem origem")).toMatchObject({ origin: "UNAVAILABLE", referenceCapacityHours: null, withoutReferencePeople: 1 });
    expect(result.sectors.reduce((sum, row) => sum + (row.nominal.scenarios[0].capacityHours ?? 0), 0)).toBe(result.nominal.scenarios[0].capacityHours);
    expect(analyzeCoverage(input, input, { comparableEmployeeIds: ["0"] }).sectors.find(row => row.sector === "Padaria")?.nominal.referenceCapacityHours).toBeNull();
  });
  it("links the compact peak window to function-inclusive missing rather than headcount alone", () => {
    const input = fixture(2); input.employees[1].role = "Outra função";
    input.demands = [{ ...input.demands[0], minimum: 2 }, { ...input.demands[0], id: "other", role: "Padeiro", minimum: 1 }];
    const row = sector(input);
    expect(row.confirmed).toMatchObject({ peakMissing: 2, peakSectorMissing: 1,
      peakWindow: { date: day, start: 540, end: 600, missing: 2, required: 3, present: 2, sectorMissing: 1, roleMissing: 2 } });
    expect(row).not.toHaveProperty("details");
  });
  it("keeps confirmed and estimated peak occurrences independent", () => {
    const input = fixture();
    input.demands = [{ ...input.demands[0], minimum: 2 }, { ...input.demands[0], id: "estimate", start: 660, end: 720, minimum: 3, estimated: true }];
    input.coverageBasis = coverageBasis(input);
    const row = sector(input);
    expect(row.confirmed).toMatchObject({ peakMissing: 1, peakWindow: { start: 540, end: 600, missing: 1, required: 2, present: 1 } });
    expect(row.estimated).toMatchObject({ peakMissing: 3, peakWindow: { start: 660, end: 720, missing: 3, required: 3, present: 0 } });
  });
  it("breaks peak ties by earliest civil date and then earliest exact interval regardless of input order", () => {
    const input = fixture(); input.endDate = "2026-11-03";
    input.shifts[0].segments.push({ start: 660, end: 720, kind: "WORK" });
    input.assignments.push({ ...input.assignments[0], date: input.endDate });
    input.demands = [day, input.endDate].flatMap(date => [540, 660].map(start => ({ ...input.demands[0], id: date + start, date, start, end: start + 60, minimum: 2 })));
    const first = analyzeCoverage(input, input).sectors[0].confirmed;
    input.demands.reverse(); input.assignments.reverse();
    const reversed = analyzeCoverage(input, input, { dates: [input.endDate, day] }).sectors[0].confirmed;
    expect(first?.peakWindow).toEqual({ date: day, start: 540, end: 600, missing: 1, required: 2, present: 1, sectorMissing: 1, roleMissing: 1 });
    expect(reversed).toEqual(first);
  });
  it("returns no invented peak occurrence for covered or later-incomplete measurements", () => {
    const input = fixture();
    expect(sector(input).confirmed).toMatchObject({ peakMissing: 0, peakWindow: null });
    input.endDate = "2026-11-03"; input.demands[0].minimum = 2;
    input.demands.push({ ...input.demands[0], id: "unknown", date: input.endDate });
    expect(sector(input).confirmed).toMatchObject({ deficitPersonMinutes: null, peakMissing: null, peakWindow: null });
  });
});
