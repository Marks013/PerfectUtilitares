import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { coverageBasis } from "./automatic-coverage";
import { buildCoverageReport } from "./coverage-report";
import type { EscalaEmployee } from "./types";

const date = "2026-12-01";
function fixture() {
  const input = newInput("06", "Filial", "2026-12", 42);
  input.startDate = input.endDate = date; input.visibleMonth = undefined; input.policy.closedDates = [];
  const person: EscalaEmployee = { id: "a", name: "A", registration: "a", sector: "Setor", role: "Função", weeklyHours: 42,
    shiftIds: ["clock"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
    preferredOffDays: [], historyKnown: false, history: [], scheduleMode: "TIMED" };
  input.employees = [person]; input.shifts = [{ id: "clock", name: "Conhecido", segments: [{ start: 540, end: 600, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "a", date, kind: "WORK", shiftId: "clock" }];
  input.demands = [{ id: "reference", date, sector: "Setor", role: "Função", start: 540, end: 600, minimum: 2 }];
  return input;
}
describe("shared coverage report projection", () => {
  it("explains the fixed reference, presence, duration and function difference without changing inputs", () => {
    const input = fixture(), before = structuredClone(input), report = buildCoverageReport(input, input, { context: { revision: 19, kind: "SAVED", runtime: "immutable" } });
    const row = report.rows[0];
    expect(row).toMatchObject({ ruler: "CONFIRMED", status: "GAP", deficitPersonMinutes: 60, deficitHours: 1, deficitRate: 0.5,
      minutesWithGap: 60, daysWithGap: 1, peak: { required: 2, presentTimed: 1, missing: 1, durationMinutes: 60,
        limitingRoles: [{ role: "Função", required: 2, present: 1, missing: 1 }], observed: { presentTimed: 1, off: 0 } } });
    expect(report.context).toMatchObject({ revision: 19, kind: "SAVED", restRulesVersion: input.restRulesVersion ?? 1 });
    expect(input).toEqual(before);
  });
  it("does not call a zero reference a no-team alert and keeps zero distinct from unknown", () => {
    const input = fixture(); input.demands[0].minimum = 0; input.assignments[0] = { employeeId: "a", date, kind: "OFF" };
    expect(buildCoverageReport(input, input).rows[0]).toMatchObject({ status: "NO_REFERENCE", deficitRate: null, daysWithoutTimedWork: 0, peak: null });
    input.demands[0].minimum = 1; input.assignments = [];
    expect(buildCoverageReport(input, input).rows[0]).toMatchObject({ status: "UNKNOWN", deficitPersonMinutes: null, deficitHours: null, daysWithoutTimedWork: null, unknownDates: [date] });
  });
  it("uses each ruler's positive slices and never sums peaks or rounded slice-hours", () => {
    const input = fixture(); input.shifts[0].segments = [{ start: 540, end: 541, kind: "WORK" }];
    input.demands = [{ ...input.demands[0], end: 541, minimum: 2 }, { ...input.demands[0], id: "later", start: 600, end: 601, minimum: 1 }];
    const row = buildCoverageReport(input, input).rows[0];
    expect(row).toMatchObject({ deficitPersonMinutes: 2, deficitHours: 2 / 60, minutesWithGap: 2, daysWithGap: 1, daysWithoutTimedWork: 1, peak: { missing: 1, start: 540, end: 541 } });
  });
  it("shows an estimated ruler with its valid basis, separately from nominal capacity", () => {
    const input = fixture(); input.demands[0].estimated = true; input.coverageBasis = coverageBasis(input);
    const report = buildCoverageReport(input, input);
    expect(report.rows[0]).toMatchObject({ ruler: "ESTIMATED", label: "Referência estimada de cobertura", status: "GAP" });
    expect(report.nominalBySector[0].nominal.referenceCapacityHours).toBeNull();
    input.defaultWeeklyHours = 40;
    expect(buildCoverageReport(input, input).rows[0]).toMatchObject({ status: "UNKNOWN", peak: null, deficitRate: null });
  });
  it("reports a local supply upper bound without treating an unlocked OFF as unavailable potential", () => {
    const input = fixture(); input.assignments[0] = { employeeId: "a", date, kind: "OFF" };
    let row = buildCoverageReport(input, input).rows[0];
    expect(row.peak?.supply).toMatchObject({ status: "REFERENCE_EXCEEDS_LOCAL_UPPER_BOUND", potentialTimedPeople: 1 });
    input.demands[0].minimum = 1;
    row = buildCoverageReport(input, input).rows[0];
    expect(row.peak?.supply.status).toBe("WITHIN_LOCAL_UPPER_BOUND");
    expect(row.peak?.observed?.off).toBe(1);
  });
});
