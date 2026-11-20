import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { dateRange, dayOfWeek } from "./dates";
import { applyBranchRestCalendar, variableRestGroups, variableRestIssues } from "./rest-configuration";

function fixture() {
  const input = newInput("02", "Filial sintética", "2027-01", 40);
  input.restRulesVersion = 3;
  input.policy.calendarMode = "MANUAL";
  input.employees = [{ ...newEmployee(40), id: "synthetic", registration: "S-1", name: "Pessoa sintética",
    sector: "Sintético", role: "Função", activeFrom: "2020-01-01", scheduleMode: "UNTIMED", shiftIds: [] }];
  input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "synthetic", date,
    kind: [2, 6].includes(dayOfWeek(date)) ? "OFF" as const : "DUTY" as const }));
  for (const item of input.assignments) {
    if (item.date === "2027-02-03") item.kind = "DUTY";
    if (item.date === "2027-02-04") item.kind = "OFF";
  }
  return applyBranchRestCalendar(input);
}

describe("visible-month rotation is not satisfied by padding dates", () => {
  it("rejects a fixed January even when February has a different pair", () => {
    const input = fixture(), before = structuredClone(input);
    const groups = variableRestGroups(input, input.employees[0]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
    expect(groups[0][0][0]).toBe("2027-01-03");
    expect(groups[0][3][6]).toBe("2027-01-30");
    expect(variableRestIssues(input).map(issue => issue.code)).toEqual(["VARIABLE_REST_PATTERN_FIXED"]);
    expect(input).toEqual(before);
  });
  it("accepts variation inside the visible month and infers the same legacy presentation", () => {
    const input = fixture();
    delete input.visibleMonth;
    expect(variableRestIssues(input)).toHaveLength(1);
    for (const item of input.assignments) {
      if (item.date === "2027-01-13") item.kind = "DUTY";
      if (item.date === "2027-01-14") item.kind = "OFF";
    }
    expect(variableRestIssues(input)).toEqual([]);
  });
  it("does not invent rotation opportunities from protected visible weeks or padding", () => {
    const input = fixture();
    for (const item of input.assignments) {
      if (["2027-01-03", "2027-01-10", "2027-01-17"].includes(item.date)) item.locked = true;
    }
    expect(variableRestGroups(input, input.employees[0])).toEqual([]);
    expect(variableRestIssues(input)).toEqual([]);
  });
});
