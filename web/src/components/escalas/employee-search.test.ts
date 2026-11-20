import { describe, expect, it } from "vitest";
import { newEmployee } from "./workspace-model";
import { indexEmployees, searchEmployees } from "./employee-search";

const team = [
  { ...newEmployee(42), id: "one", registration: "001", name: "José Sintético", sector: "Açougue", role: "Auxiliar" },
  { ...newEmployee(42), id: "two", registration: "02", name: "MARIA Teste", sector: "Caixas", role: "Operadora", planningEnabled: false },
];
describe("indexed employee search", () => {
  it.each([["jose", "one"], [" AÇOUGUE ", "one"], ["001", "one"], ["operadora", "two"], ["maria", "two"]])("matches %s without changing employees", (query, id) => {
    const before = structuredClone(team), result = searchEmployees(indexEmployees(team), query);
    expect(result.map(item => item.id)).toEqual([id]); expect(team).toEqual(before);
    expect(result[0]).toBe(team.find(item => item.id === id));
  });
  it("reuses a single ordered index and restores all entries when cleared", () => {
    const index = indexEmployees(team);
    expect(searchEmployees(index, "unmatched")).toEqual([]);
    expect(searchEmployees(index, "  ")).toEqual(index.map(item => item.employee));
    expect(searchEmployees(index, "")).toEqual(index.map(item => item.employee));
  });
});
