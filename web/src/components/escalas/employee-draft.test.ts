import { describe, expect, it } from "vitest";
import { hasEmployeeDraftChanges } from "./employee-draft";
import { newEmployee } from "./workspace-model";

describe("unapplied employee drafts", () => {
  it("keeps untouched and reverted values clean", () => {
    const original = newEmployee(42, []);
    expect(hasEmployeeDraftChanges(original, { ...original }, original.history)).toBe(false);
    expect(hasEmployeeDraftChanges(original, { ...original, name: "Editado" }, original.history)).toBe(true);
    expect(hasEmployeeDraftChanges(original, { ...original, name: original.name }, original.history)).toBe(false);
  });
  it("includes rest choices and history, not only identity fields", () => {
    const original = newEmployee(42, []);
    expect(hasEmployeeDraftChanges(original, { ...original, preferredOffDays: [2] }, original.history)).toBe(true);
    expect(hasEmployeeDraftChanges(original, original, [{ employeeId: original.id, date: "2027-01-31", kind: "OFF" }])).toBe(true);
    expect(original.history).toEqual([]);
  });
});
