import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { escalaInputSchema } from "./schema";
import { generationScenarioBasis, validateHoursReferences } from "./hours-reference";

function fixture() {
  const input = newInput("08", "Filial sintética", "2027-01", 42);
  input.startDate = "2027-01-10";
  input.endDate = "2027-01-16";
  input.generationMode = "HOURS_ONLY";
  input.needsRegeneration = false;
  input.policy.compensationAuthorized = true;
  input.shifts = [{ id: "day", name: "Referência sintética", segments: [
    { start: 480, end: 720, kind: "WORK" },
    { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 1044, kind: "WORK" },
  ] }];
  input.employees = [{ ...newEmployee(42, "day"), id: "p", registration: "0001", name: "Colaborador sintético",
    sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: "TIMED" }];
  input.generationBasis = generationScenarioBasis(input);
  return input;
}

describe("clock validation hardening", () => {
  it("requires explicit classification for the entire span between work segments", () => {
    const input = fixture();
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    input.shifts[0].segments[2].start = 960;
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    input.shifts[0].segments[2].start = 750;
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    input.shifts[0].segments[2].start = 780;
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });

  it("blocks a single 7-hour reference for a full 42-hour week, without inventing days", () => {
    const input = fixture();
    input.shifts[0].segments[2].end = 960;
    input.generationBasis = generationScenarioBasis(input);
    const original = structuredClone(input);
    const result = validateHoursReferences(input);
    expect(result.valid).toBe(false);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "HOURS_WEEKLY_REFERENCE_INCOMPATIBLE", employeeId: "p", severity: "ERROR",
    }));
    expect(input).toEqual(original);
    expect(input.assignments).toEqual([]);
  });

  it("accepts attainable 42-hour references with a closed Sunday", () => {
    const input = fixture();
    input.policy.closedDates = ["2027-01-10"];
    input.generationBasis = generationScenarioBasis(input);
    expect(validateHoursReferences(input).issues.some(issue => issue.code === "HOURS_WEEKLY_REFERENCE_INCOMPATIBLE")).toBe(false);
  });

  it("allows a configured 42-hour mixed combination of three 8h and two 9h references", () => {
    const input = fixture();
    input.mixed42Sectors = ["Loja"];
    input.shifts = [
      { id: "eight", name: "8h", segments: [
        { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" },
      ] },
      { id: "nine", name: "9h misto", segments: [
        { start: 480, end: 750, kind: "WORK" }, { start: 750, end: 930, kind: "BREAK" }, { start: 930, end: 1200, kind: "WORK" },
      ] },
    ];
    input.employees[0].shiftIds = ["eight", "nine"];
    input.generationBasis = generationScenarioBasis(input);
    expect(validateHoursReferences(input).issues.some(issue => issue.code === "HOURS_WEEKLY_REFERENCE_INCOMPATIBLE")).toBe(false);
  });

  it("does not infer an entire week for a partial employee link", () => {
    const input = fixture();
    input.shifts[0].segments[2].end = 960;
    input.employees[0].activeFrom = "2027-01-12";
    input.generationBasis = generationScenarioBasis(input);
    expect(validateHoursReferences(input).issues.some(issue => issue.code === "HOURS_WEEKLY_REFERENCE_INCOMPATIBLE")).toBe(false);
  });
});
