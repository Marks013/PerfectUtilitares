import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { newEmployee } from "@/components/escalas/workspace-model";
import { newLegacyInput as newInput } from "./legacy-calendar-test-fixture";
import { admitCandidateReference, issueCandidateReceipt, selectCandidateReference } from "./candidate-reference.server";
import { applyBranchRestCalendar } from "./rest-configuration";
import { withFixedRestSlots } from "./fixed-rest";
import type { EscalaAssignment, EscalaInput } from "./types";
vi.mock("./solver-transport", () => ({ candidateReferenceSignature: (payload: string) => createHmac("sha256", "synthetic-test-key").update(payload).digest("hex") }));
const scope = { tenantId: "tenant", owner: "access", workspaceId: "workspace", revision: 1 };
const now = 1_800_000_000_000;
function fixture(): EscalaInput {
  const input = newInput("06", "Synthetic", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.simulation = true; input.restRulesVersion = 1;
  input.shifts = [{ id: "day", name: "Day", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42, "day"), id, registration: id, name: "Synthetic", sector: "Store", role: id === "a" ? "Fiscal" : "Zelador", activeFrom: "2020-01-01" }));
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, day) => {
    const off = (person.id === "a" ? [1, 6] : [2, 6]).includes(day);
    return { employeeId: person.id, date: `2026-11-0${day + 2}`, kind: off ? "OFF" as const : "WORK" as const, ...(!off ? { shiftId: "day" } : {}) };
  }));
  input.demands = [{ id: "fiscal", date: "2026-11-03", sector: "Store", role: "Fiscal", start: 480, end: 720, minimum: 2, estimated: true },
    { id: "zelador", date: "2026-11-03", sector: "Store", role: "Zelador", start: 480, end: 540, minimum: 1, estimated: true }];
  return input;
}
describe("authenticated candidate continuity with explicit rest rules", () => {
  it("compares two v3 branch-02 candidates against unchanged legacy staffing targets", () => {
    const base = fixture(); base.branchCode = "02";
    const context = applyBranchRestCalendar({ ...base, restRulesVersion: 3 });
    const proposal = structuredClone(context);
    proposal.assignments = context.assignments.map((day): EscalaAssignment => {
      if (day.date === "2026-11-03") return day.employeeId === "a" ? { ...day, kind: "WORK", shiftId: "day" } : { employeeId: day.employeeId, date: day.date, kind: "OFF" };
      if (day.date === "2026-11-04") return day.employeeId === "b" ? { ...day, kind: "WORK", shiftId: "day" } : { employeeId: day.employeeId, date: day.date, kind: "OFF" };
      return day;
    });
    const before = structuredClone({ base, context, proposal });
    const receipt = issueCandidateReceipt(scope, base, context, context, now);
    const admitted = admitCandidateReference({ input: context, receipt }, scope, base, context, now);
    expect(admitted.comparison.admission).toBe("ADMITTED");
    const selected = selectCandidateReference(admitted, proposal, base);
    expect(selected.comparison).toMatchObject({ admission: "ADMITTED", selection: "REFERENCE_RETAINED", reason: "ROLE_TIME_COVERAGE" });
    expect(selected.input.assignments).toEqual(context.assignments);
    expect({ base, context, proposal }).toEqual(before);
    expect(issueCandidateReceipt(scope, base, context, context, now)).toEqual(receipt);
  });
  it("does not normalize unrelated manual closures to admit a comparison", () => {
    const base = fixture(); base.branchCode = "02";
    const context = applyBranchRestCalendar({ ...base, restRulesVersion: 3 });
    const receipt = issueCandidateReceipt(scope, base, context, context, now);
    const admitted = admitCandidateReference({ input: context, receipt }, scope, base, context, now);
    const ruler = structuredClone(base); ruler.policy.closedDates.push("2026-11-06");
    const before = structuredClone(ruler);
    expect(selectCandidateReference(admitted, context, ruler).comparison).toMatchObject({
      admission: "INCOMPATIBLE", selection: "NOT_USED", reason: "REFERENCE_NOT_COMPARABLE",
    });
    expect(ruler).toEqual(before);
  });
  it("invalidates a receipt when an independently stored fixed-rest slot is enabled", () => {
    const base = fixture(); base.branchCode = "02";
    base.employees[0] = withFixedRestSlots(base.employees[0], [{ weekday: 1, enabled: false }, { weekday: 6, enabled: false }]);
    const context = applyBranchRestCalendar({ ...base, restRulesVersion: 3 });
    const receipt = issueCandidateReceipt(scope, base, context, context, now);
    const changed = structuredClone(context);
    changed.employees[0] = withFixedRestSlots(changed.employees[0], [{ weekday: 1, enabled: true }, { weekday: 6, enabled: false }]);
    expect(admitCandidateReference({ input: context, receipt }, scope, base, changed, now).comparison).toMatchObject({
      admission: "SCENARIO_CHANGED", selection: "NOT_USED",
    });
  });
});
