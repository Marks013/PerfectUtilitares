import { describe, expect, it } from "vitest";
import { turnoCatalogOptionsSchema, turnoSelectionManifestSchema } from "./flow-contracts";
const filters = { branchCodes: [], employeeKeys: [], sectors: [], catalogCodes: [], registrations: [] };
const catalog = { selectionVersion: 2, mode: "CATALOG", scope: "ALL", sources: [], year: 2026, month: 12, filters, codes: [1500] };
describe("additive shift flow contract", () => {
  it("preserves canonical branch labels of 100, 101 and 160 characters in relational modes", () => {
    for (const length of [100, 101, 160, 161]) {
      const branchCodes = ["F".repeat(length)];
      for (const value of [
        { ...catalog, scope: "USED", sources: [{ workspaceId: "w", revision: 1 }], filters: { ...filters, branchCodes } },
        { selectionVersion: 2, mode: "EMPLOYEES", year: 2026, month: 12, sources: [{ workspaceId: "w", revision: 1 }],
          filters: { ...filters, branchCodes }, members: [{ workspaceId: "w", employeeId: "p", localShiftId: null }] },
      ]) expect(turnoSelectionManifestSchema.safeParse(value).success).toBe(length <= 160);
    }
    expect(turnoCatalogOptionsSchema.safeParse({ workspaceId: "w".repeat(101), employeeId: "p", expectedRevision: 1,
      effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" }).success).toBe(false);
  });
  it("admits standalone catalog and exact employee selection, preserving textual registration filters", () => {
    expect(turnoSelectionManifestSchema.parse(catalog).mode).toBe("CATALOG");
    const value = turnoSelectionManifestSchema.parse({ selectionVersion: 2, mode: "EMPLOYEES", year: 2026, month: 12,
      sources: [{ workspaceId: "w", revision: 1 }], filters: { ...filters, registrations: ["0007", "7", "AB07", ""] },
      members: [{ workspaceId: "w", employeeId: "p", localShiftId: null }] });
    expect(value.filters.registrations).toEqual(["0007", "7", "AB07", ""]);
  });
  it("rejects empty or duplicated selection, hidden authority and relational ALL filters", () => {
    for (const value of [{ ...catalog, codes: [] }, { ...catalog, codes: [1500, 1500] }, { ...catalog, tenantId: "other" },
      { ...catalog, filters: { ...filters, registrations: ["0007"] } }, { ...catalog, scope: "USED" }]) {
      expect(turnoSelectionManifestSchema.safeParse(value).success).toBe(false);
    }
  });
  it("bounds codes, sources, members, filters and contextual pagination", () => {
    expect(turnoSelectionManifestSchema.safeParse({ ...catalog, codes: Array(5001).fill(1500) }).success).toBe(false);
    expect(turnoSelectionManifestSchema.safeParse({ ...catalog, filters: { ...filters, sectors: [{ workspaceId: "w", value: "x".repeat(161) }] } }).success).toBe(false);
    const query = { workspaceId: "w", employeeId: "p", expectedRevision: "1", effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" };
    expect(turnoCatalogOptionsSchema.parse(query).limit).toBe(30);
    for (const extra of [{ limit: 101 }, { effectiveUntil: "2026-11-30" }, { effectiveFrom: "2026-02-30" }, { cursor: -1 }, { tenantId: "other" }]) {
      expect(turnoCatalogOptionsSchema.safeParse({ ...query, ...extra }).success).toBe(false);
    }
  });
  it("enforces each collection boundary and rejects duplicated sources and members", () => {
    const employees = { selectionVersion: 2, mode: "EMPLOYEES", year: 2026, month: 12, filters,
      sources: [{ workspaceId: "w", revision: 1 }], members: [{ workspaceId: "w", employeeId: "p", localShiftId: null }] };
    for (const value of [
      { ...employees, sources: Array.from({ length: 51 }, (_, index) => ({ workspaceId: `w${index}`, revision: 1 })) },
      { ...employees, sources: [employees.sources[0], employees.sources[0]] },
      { ...employees, members: [employees.members[0], employees.members[0]] },
      { ...employees, members: Array.from({ length: 251 }, (_, index) => ({ workspaceId: "w", employeeId: `p${index}`, localShiftId: null })) },
      { ...employees, members: Array.from({ length: 1001 }, (_, index) => ({ workspaceId: `w${Math.floor(index / 250)}`, employeeId: `p${index}`, localShiftId: null })) },
      { ...employees, filters: { ...filters, registrations: Array(1001).fill("0007") } },
      { ...employees, filters: { ...filters, employeeKeys: Array(1001).fill({ workspaceId: "w", employeeId: "p" }) } },
      { ...employees, filters: { ...filters, sectors: Array(1001).fill({ workspaceId: "w", value: "A" }) } },
      { ...employees, filters: { ...filters, branchCodes: Array(51).fill("01") } },
      { ...employees, filters: { ...filters, catalogCodes: Array(5001).fill(1500) } },
    ]) expect(turnoSelectionManifestSchema.safeParse(value).success).toBe(false);
  });
});
