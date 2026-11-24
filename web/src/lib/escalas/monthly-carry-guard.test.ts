import { describe, expect, it } from "vitest";
import { prepareWithMonthlyCarry, retainMonthlyCarry } from "./monthly-carry-guard";
import { scopedMonthDraft } from "./scoped-month-draft";
import type { EscalaAssignment } from "./types";

describe("monthly carry provenance", () => {
  const holiday = { employeeId: "person", date: "2027-01-01", kind: "HOLIDAY", monthlyCarry: true, carriedHolidayRest: true } as const;
  const inherited = { employeeId: "person", date: "2027-01-03", kind: "OFF", locked: false, monthlyCarry: true } as const;
  const setup = () => ({ ...scopedMonthDraft("07", "2027-01"), assignments: [holiday, inherited] });

  it("discards caller-created provenance and keeps an unchanged stored holiday coincidence", () => {
    const saved = setup();
    expect(retainMonthlyCarry(undefined, saved).assignments.every(day => !day.monthlyCarry && !day.carriedHolidayRest)).toBe(true);
    expect(retainMonthlyCarry(saved, saved).assignments).toEqual(saved.assignments);
    const edited: EscalaAssignment = { ...inherited, kind: "DUTY" };
    expect(retainMonthlyCarry(saved, { ...saved, assignments: [holiday, edited] }).assignments[1]).not.toHaveProperty("monthlyCarry");
  });

  it("temporarily pins an unchanged inherited rest and restores its editability", () => {
    const saved = setup();
    const result = prepareWithMonthlyCarry(saved, input => {
      expect(input.assignments[0]).toBe(holiday);
      expect(input.assignments[1].locked).toBe(true);
      return { input, phase: "prepared" };
    });
    expect(result.input.assignments).toEqual(saved.assignments);
    expect(result.phase).toBe("prepared");
    expect(() => prepareWithMonthlyCarry(saved, input => ({ input: { ...input, assignments: [holiday] } })))
      .toThrow("As folgas ou horários herdados conflitam");
  });
});
