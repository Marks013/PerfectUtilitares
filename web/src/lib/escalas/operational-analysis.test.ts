import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { analyzeOperational } from "./operational-analysis";
import type { EscalaEmployee } from "./types";
const date = "2026-12-01";
function fixture() {
  const input = newInput("06", "Filial", "2026-12", 42); input.policy.closedDates = [];
  const person = (id: string): EscalaEmployee => ({ id, name: id, registration: id, sector: "Setor", role: "Função", weeklyHours: 42,
    shiftIds: ["clock"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [], scheduleMode: "TIMED" });
  input.employees = [person("a"), { ...person("enc"), role: "ENC", scheduleMode: "UNTIMED", shiftIds: [] }];
  input.shifts = [{ id: "clock", name: "Original", segments: [{ start: 540, end: 560, kind: "WORK" }, { start: 560, end: 580, kind: "PAID_BREAK" }, { start: 580, end: 600, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "a", date, kind: "WORK", shiftId: "clock" }, { employeeId: "enc", date, kind: "DUTY" }];
  input.demands = []; return input;
}
describe("operational calendar projection", () => {
  it("keeps a MISSING schedule mode unknown even when a WORK record names a valid shift", () => {
    const input = fixture(); input.employees[0].scheduleMode = "MISSING";
    expect(analyzeOperational(input, { dates: [date] }).days[0]).toMatchObject({
      status: "PARTIAL", counts: { workTimed: 0, workWithoutClock: 1, unknownClock: 1 },
      knownWorkPersonMinutes: 0, workPersonMinutes: null, creditedPersonMinutes: null,
    });
  });
  it("separates WORK, DUTY and paid pause using real boundaries and retains native minutes", () => {
    const input = fixture(), before = structuredClone(input), report = analyzeOperational(input, { dates: [date], details: true }), row = report.days[0];
    expect(row).toMatchObject({ status: "KNOWN", counts: { workTimed: 1, duty: 1 }, knownWorkPersonMinutes: 40, workPersonMinutes: 40, creditedPersonMinutes: 60 });
    expect(row.windows?.find(window => window.start === 560)).toMatchObject({ end: 580, counts: { presentTimed: 0, pause: 1, duty: 1 }, knownWorkPersonMinutes: 0, knownCreditedPersonMinutes: 20 });
    expect(row.shiftGroups).toMatchObject([{ shiftId: "clock", people: 1, knownWorkPersonMinutes: 40, knownCreditedPersonMinutes: 60 }]);
    expect(input).toEqual(before);
  });
  it("clips the calendar to the visible month, deduplicates records and leaves missing days unknown", () => {
    const input = fixture(); input.assignments.push({ ...input.assignments[0] });
    const report = analyzeOperational(input, { dates: [date, "2026-11-30", "2026-12-02"] });
    expect(report.omittedDates).toEqual(["2026-11-30"]);
    expect(report.days.find(row => row.date === date)?.counts.workTimed).toBe(1);
    expect(report.days.find(row => row.date === "2026-12-02")).toMatchObject({ status: "PARTIAL", workPersonMinutes: null });
    expect(report.days[0]).not.toHaveProperty("windows");
  });
  it("does not manufacture a HOURS_ONLY calendar from absence/holiday references", () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.assignments = [{ employeeId: "a", date, kind: "ABSENCE" }, { employeeId: "enc", date, kind: "HOLIDAY" }];
    expect(analyzeOperational(input)).toMatchObject({ status: "UNAVAILABLE", days: [] });
  });
  it("keeps exclusions, absent people, holidays and malformed TIMED work distinct", () => {
    const input = fixture(); input.employees[1] = { ...input.employees[0], id: "bad" };
    input.assignments[1] = { employeeId: "bad", date, kind: "WORK", shiftId: "unknown" };
    expect(analyzeOperational(input, { dates: [date] }).days[0]).toMatchObject({ status: "PARTIAL", counts: { workTimed: 1, workWithoutClock: 1, unknownClock: 1 }, workPersonMinutes: null });
    input.assignments[1] = { employeeId: "bad", date, kind: "ABSENCE" };
    expect(analyzeOperational(input, { dates: [date] }).days[0]).toMatchObject({ status: "KNOWN", counts: { absence: 1 }, workPersonMinutes: 40 });
    input.assignments[1] = { employeeId: "bad", date, kind: "HOLIDAY" }; input.employees[0].planningEnabled = false;
    expect(analyzeOperational(input, { dates: [date] }).days[0].counts).toMatchObject({ excluded: 1, holiday: 1 });
  });
});
