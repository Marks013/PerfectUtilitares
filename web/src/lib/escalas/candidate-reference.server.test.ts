import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { admitCandidateReference, issueCandidateReceipt, selectCandidateReference } from "./candidate-reference.server";
import { validateEscala } from "./validation";
import { coverageQuality } from "./roster-quality";
import { escalaInputSchema } from "./schema";
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
const reference = (input = fixture()) => ({ input, receipt: issueCandidateReceipt(scope, input, input, input, now) });
describe("authenticated candidate continuity", () => {
  it("admits a complete valid reference with stable unordered collections", () => {
    const input = fixture(), candidate = reference(input), context = structuredClone(input);
    context.employees.reverse(); context.assignments.reverse(); context.demands.reverse();
    expect(admitCandidateReference(candidate, scope, context, context, now + 1)).toMatchObject({ comparison: { admission: "ADMITTED" } });
    expect(candidate.receipt.expiresAt - candidate.receipt.issuedAt).toBe(15 * 60_000);
  });
  it.each(["input", "signature", "tenant", "owner", "workspace", "malformed", "expired-signature", "receipt-revision"])("rejects %s alteration before a reference is available", kind => {
    const input = fixture(), candidate = reference(input), current = { ...scope };
    if (kind === "input") candidate.input.shifts[0].segments[0].start++;
    if (kind === "signature" || kind === "expired-signature") candidate.receipt.signature = "0".repeat(64);
    if (kind === "receipt-revision") candidate.receipt.revision++;
    if (kind === "tenant") current.tenantId = "foreign";
    if (kind === "owner") current.owner = "foreign";
    if (kind === "workspace") current.workspaceId = "foreign";
    expect(() => admitCandidateReference(kind === "malformed" ? { input } : candidate, current, input, input, kind === "expired-signature" ? candidate.receipt.expiresAt + 1 : now)).toThrow();
  });
  it.each(["expiry", "revision", "policy", "continuity"])("authenticates but does not use a legitimately changed %s", kind => {
    const input = fixture(), candidate = reference(input), context = structuredClone(input);
    const current = { ...scope }; let clock = now;
    if (kind === "expiry") clock += 15 * 60_000 + 1;
    if (kind === "revision") current.revision++;
    if (kind === "policy") context.policy.minMealMinutes++;
    if (kind === "continuity") context.employees[0].planningFuture = [{ employeeId: "a", date: "2026-11-09", kind: "OFF" }];
    expect(admitCandidateReference(candidate, current, input, context, clock)).toMatchObject({ comparison: { admission: kind === "expiry" ? "EXPIRED" : "SCENARIO_CHANGED", selection: "NOT_USED" } });
  });
  it("does not admit incomplete or operationally incompatible signed input", () => {
    const input = fixture(), incomplete = { ...input, assignments: input.assignments.slice(1) };
    const receipt = issueCandidateReceipt(scope, input, input, incomplete, now);
    expect(admitCandidateReference({ input: incomplete, receipt }, scope, input, input, now)).toMatchObject({ comparison: { admission: "INCOMPATIBLE" } });
  });
  it("does not bind receipts to an ephemeral calculation operation", () => {
    const input = fixture();
    expect(issueCandidateReceipt({ ...scope, ...{ operationId: "first" } }, input, input, input, now))
      .toEqual(issueCandidateReceipt({ ...scope, ...{ operationId: "second" } }, input, input, input, now));
  });
  it.each(["catalog", "HOURS_ONLY"])("does not admit a signed but incompatible %s", kind => {
    const context = fixture(), input = structuredClone(context);
    if (kind === "catalog") {
      input.shifts[0].id = "different-catalog";
      input.employees.forEach(person => { person.shiftIds = ["different-catalog"]; });
      input.assignments.forEach(day => { if (day.kind === "WORK") day.shiftId = "different-catalog"; });
    } else {
      input.generationMode = "HOURS_ONLY"; context.generationMode = "HOURS_ONLY";
      input.assignments = input.assignments.map((day): EscalaAssignment => day.employeeId === "a" && day.date === "2026-11-03"
        ? { ...day, kind: "WORK", shiftId: "day" } : day.employeeId === "a" && day.date === "2026-11-04" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" } : day);
    }
    const receipt = issueCandidateReceipt(scope, context, context, input, now);
    expect(admitCandidateReference({ input, receipt }, scope, context, context, now)).toMatchObject({ comparison: { admission: "INCOMPATIBLE", selection: "NOT_USED" } });
  });
  it("allows a 2/0 to 1/1 date rotation inside the same monthly role/time vector", () => {
    const input = fixture(); input.defaultWeeklyHours = 40;
    input.employees.forEach(person => { person.weeklyHours = 40; person.role = "Operator"; });
    input.shifts[0].segments[2].end = 1020;
    input.assignments = input.assignments.map((day): EscalaAssignment => day.date === "2026-11-03" ? { ...day, kind: "WORK", shiftId: "day" }
      : day.date === "2026-11-04" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" } : day);
    input.demands = ["2026-11-03", "2026-11-04"].flatMap(date => [[480, 720], [780, 1020]].map(([start, end]) => ({ id: date + start, date, sector: "Store", role: "Operator", start, end, minimum: 2, estimated: true })));
    const proposal = { ...input, assignments: input.assignments.map((day): EscalaAssignment => day.employeeId === "b" && day.date === "2026-11-03"
      ? { employeeId: day.employeeId, date: day.date, kind: "OFF" } : day.employeeId === "b" && day.date === "2026-11-04" ? { ...day, kind: "WORK", shiftId: "day" } : day) };
    expect(validateEscala(input).valid).toBe(true); expect(validateEscala(proposal).valid).toBe(true);
    const selected = selectCandidateReference(admitCandidateReference(reference(input), scope, input, input, now), proposal, input);
    expect(selected.comparison).toMatchObject({ admission: "ADMITTED", selection: "CANDIDATE_SELECTED" });
    expect(selected.input.assignments).toEqual(proposal.assignments);
  });
  it("retains the entire authenticated catalog when a better total hides a role loss", () => {
    const input = fixture(), proposal = structuredClone(input);
    proposal.assignments = input.assignments.map((day): EscalaAssignment => {
      if (day.date === "2026-11-03") return day.employeeId === "a" ? { ...day, kind: "WORK", shiftId: "day" } : { employeeId: day.employeeId, date: day.date, kind: "OFF" };
      if (day.date === "2026-11-04") return day.employeeId === "b" ? { ...day, kind: "WORK", shiftId: "day" } : { employeeId: day.employeeId, date: day.date, kind: "OFF" };
      return day;
    });
    expect(validateEscala(input).valid).toBe(true); expect(validateEscala(proposal).valid).toBe(true);
    const total = (value: EscalaInput) => [...coverageQuality(value).daily.values()].reduce((sum, n) => sum + n, 0);
    expect([total(input), total(proposal)]).toEqual([480, 300]);
    const admitted = admitCandidateReference(reference(input), scope, input, input, now);
    const selected = selectCandidateReference(admitted, proposal, input);
    expect(selected.input).toEqual(escalaInputSchema.parse(input));
    expect(selected.comparison).toMatchObject({ admission: "ADMITTED", selection: "REFERENCE_RETAINED", reason: "ROLE_TIME_COVERAGE" });
    expect(selected.input.shifts).toEqual(input.shifts);
  });
});
