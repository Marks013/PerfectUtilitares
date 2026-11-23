import { describe, expect, it } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoCatalogEntryDto } from "@/lib/escalas/shift-catalog/contracts";
import type { TurnoSelectionManifestDto, TurnoSelectionManifestRequest } from "@/lib/escalas/shift-catalog/flow-contracts";
import { TURNO_CATALOG_EXPORT_FORMATS, TURNO_EMPLOYEE_EXPORT_FORMATS } from "@/lib/escalas/shift-catalog/flow-contracts";
import { newEmployee, newInput } from "../workspace-model";
import { chosenReference, confirmManifest, emptyFilters, expectedBytes, filteredCatalog, filterPeople, flowPeople, intentKey, intersectSelection, personKey, selectionRequest } from "./flow-model";

const entries: TurnoCatalogEntryDto[] = [
  { code: 1500, name: "08:00 12:00 14:00 18:24", markings: ["08:00", "12:00", "14:00", "18:24"] },
  { code: 1501, name: "09:00 13:00 15:00 19:24", markings: ["09:00", "13:00", "15:00", "19:24"] },
  { code: 1502, name: "07:00 11:00 13:00 17:24", markings: ["07:00", "11:00", "13:00", "17:24"] },
];
function workspace(id = "a", branchCode = "07"): EscalaWorkspace {
  const input = newInput(branchCode, "Centro", "2026-12", 42);
  input.shifts = [{ id: "s1", name: "Primeiro", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] },
    { id: "s2", name: "Segundo", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 900, kind: "BREAK" }, { start: 900, end: 1164, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(42, "s1"), id: "alice", name: "Alice", sector: "A", registration: "0007" }, { ...newEmployee(42, "s1"), id: "bob", name: "Bob", sector: "B", registration: "7" }];
  return { id, revision: 3, input, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-11-14", validation: { valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null } };
}
function catalogManifest(request: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }>): TurnoSelectionManifestDto {
  return { selectionVersion: 2, mode: "CATALOG", manifestId: "manifest", selectionDigest: "a".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), context: request, formats: TURNO_CATALOG_EXPORT_FORMATS, rows: entries.filter(entry => request.codes.includes(entry.code)), omissions: [], blockers: [], counts: { found: 3, selected: request.codes.length, includedEmployees: 0, includedCodes: request.codes.length, txt1Lines: 0, txt2Lines: request.codes.length, omitted: 0, blockers: 0 } };
}

describe("materialized turn selection", () => {
  it("omits administrative staff from people, used clocks and stale selections", () => {
    const plan = workspace();
    const [administrative] = plan.input.employees;
    administrative.sector = " Afástados ";
    administrative.shiftIds = ["s2"];
    const people = flowPeople([plan], entries);
    expect(people.map(person => person.employeeId)).toEqual(["bob"]);
    expect(filteredCatalog(entries, people, emptyFilters(), "USED").map(entry => entry.code)).toEqual([1500]);
    const staleKey = personKey({ workspaceId: plan.id, employeeId: administrative.id });
    expect(() => selectionRequest("EMPLOYEES", "ALL", "2026-12", [plan], entries, emptyFilters(), [staleKey], {}))
      .toThrow("Uma pessoa selecionada não pertence mais ao recorte");
  });
  it("combines OR within a filter and AND on the same person, without borrowing another person's sector", () => {
    const people = flowPeople([workspace()], entries);
    expect(filterPeople(people, { ...emptyFilters(), sectors: [{ workspaceId: "a", value: "A" }, { workspaceId: "a", value: "B" }] })).toHaveLength(2);
    const filters = { ...emptyFilters(), employeeKeys: [{ workspaceId: "a", employeeId: "alice" }], sectors: [{ workspaceId: "a", value: "B" }], catalogCodes: [1500] };
    expect(filterPeople(people, filters)).toEqual([]);
    expect(filteredCatalog(entries, people, filters, "USED")).toEqual([]);
  });
  it("keeps zeros textual and separates identical person/sector identities across source branches", () => {
    const people = flowPeople([workspace(), workspace("b", "08")], entries);
    expect(filterPeople(people, { ...emptyFilters(), registrations: ["0007"] })).toHaveLength(2);
    expect(filterPeople(people, { ...emptyFilters(), registrations: ["7"], branchCodes: ["07"] }).map(person => person.employeeId)).toEqual(["bob"]);
    expect(filterPeople(people, { ...emptyFilters(), sectors: [{ workspaceId: "b", value: "A" }] }).map(person => person.workspaceId)).toEqual(["b"]);
  });
  it("exports an unassigned global definition in ALL and never invents a branch owner in USED", () => {
    const people = flowPeople([workspace()], entries);
    expect(filteredCatalog(entries, people, emptyFilters(), "ALL").map(entry => entry.code)).toEqual([1500, 1501, 1502]);
    expect(filteredCatalog(entries, people, emptyFilters(), "USED").map(entry => entry.code)).toEqual([1500]);
  });
  it("materializes only selected identities, preserving page selection and removing only incompatible members", () => {
    const selected = ["page1", "page2"];
    expect(intersectSelection(selected, ["page2", "other"])).toEqual(["page2"]);
    const people = flowPeople([workspace()], entries);
    const request = selectionRequest("EMPLOYEES", "ALL", "2026-12", [workspace()], entries, emptyFilters(), [people[1].key], {});
    expect(request.mode === "EMPLOYEES" && request.members).toEqual([{ workspaceId: "a", employeeId: "bob", localShiftId: "s1" }]);
    expect(() => selectionRequest("CATALOG", "ALL", "2026-12", [], entries, emptyFilters(), [], {})).toThrow();
    expect(() => selectionRequest("EMPLOYEES", "ALL", "2026-12", [workspace()], entries, emptyFilters(), ["foreign"], {})).toThrow();
  });
  it("never guesses an ambiguous reference, including when the visual turn filter leaves one candidate", () => {
    const plan = workspace(); plan.input.employees[0].shiftIds = ["s1", "s2"];
    const person = flowPeople([plan], entries)[0], filters = { ...emptyFilters(), catalogCodes: [1500] };
    expect(chosenReference(person, {}, filters)).toBeNull();
    expect(chosenReference(person, { [person.key]: "s1" }, filters)).toBe("s1");
    expect(chosenReference(person, { [person.key]: "s2" }, filters)).toBeNull();
  });
  it("retains real excluded references, missing data and overnight limitations without inventing marks", () => {
    const plan = workspace(); plan.input.employees[0].planningEnabled = false;
    plan.input.employees[1].scheduleMode = "MISSING";
    let people = flowPeople([plan], entries);
    expect(people[0].references[0].code).toBe(1500); expect(people[1].references).toEqual([]);
    plan.input.shifts[0].segments = [{ start: 1320, end: 1680, kind: "WORK" }];
    people = flowPeople([plan], entries);
    expect(people[0].references[0]).toMatchObject({ code: null, problem: "OVERNIGHT" });
  });
  it("rejects repeated selections and stale local reference choices instead of broadening membership", () => {
    const plan = workspace(), person = flowPeople([plan], entries)[0];
    expect(() => selectionRequest("EMPLOYEES", "ALL", "2026-12", [plan], entries, emptyFilters(), [person.key, person.key], {})).toThrow();
    const request = selectionRequest("EMPLOYEES", "ALL", "2026-12", [plan], entries, emptyFilters(), [person.key], { [person.key]: "obsolete" });
    expect(request.mode === "EMPLOYEES" && request.members[0].localShiftId).toBe("s1");
  });
});

describe("manifest and byte identity", () => {
  it("accepts the same normalized explicit selection and emits exact TXT2 bytes without a fictitious registration", () => {
    const request: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }> = { selectionVersion: 2, mode: "CATALOG", scope: "ALL", month: 12, year: 2026, sources: [], filters: emptyFilters(), codes: [1500] };
    const manifest = confirmManifest(catalogManifest(request), request);
    expect(confirmManifest({ ...manifest, selectionDigest: "opaque-contract-value" }, request).selectionDigest).toBe("opaque-contract-value");
    expect(new TextDecoder().decode(expectedBytes(manifest, "TXT2"))).toBe("1500,08:00 12:00 14:00 18:24,08:00,12:00,14:00,18:24\r\n");
    expect(new TextDecoder().decode(expectedBytes(manifest, "CADASTRO"))).toBe("1500;08:00 12:00 14:00 18:24;08:00;12:00;14:00;18:24\r\n");
    expect(() => expectedBytes(manifest, "TXT1")).toThrow();
    expect(intentKey({ ...request, codes: [1501, 1500] })).toBe(intentKey({ ...request, codes: [1500, 1501] }));
  });
  it("rejects another set, mode, expired result, row count or code even if HTTP succeeded", () => {
    const request: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }> = { selectionVersion: 2, mode: "CATALOG", scope: "ALL", month: 12, year: 2026, sources: [], filters: emptyFilters(), codes: [1500] };
    const manifest = catalogManifest(request);
    expect(() => confirmManifest(manifest, { ...request, codes: [1501] })).toThrow();
    expect(() => confirmManifest({ ...manifest, expiresAt: "2000-01-01" }, request)).toThrow();
    expect(() => confirmManifest({ ...manifest, counts: { ...manifest.counts, txt2Lines: 2 } }, request)).toThrow();
    if (manifest.mode === "CATALOG") expect(() => confirmManifest({ ...manifest, rows: [entries[1]] }, request)).toThrow();
    if (manifest.mode === "CATALOG") expect(() => confirmManifest({ ...manifest, rows: [{ ...entries[0], markings: ["25:00", "12:00", "14:00", "18:24"] }] }, request)).toThrow();
    expect(() => confirmManifest(manifest, request, [{ ...entries[0], markings: entries[1].markings }])).toThrow(/marcações consultadas/);
  });
  it("keeps blockers separate and refuses arbitrary winners for duplicate registration", () => {
    const request: Extract<TurnoSelectionManifestRequest, { mode: "EMPLOYEES" }> = { selectionVersion: 2, mode: "EMPLOYEES", month: 12, year: 2026, sources: [{ workspaceId: "a", revision: 3 }], filters: emptyFilters(), members: [{ workspaceId: "a", employeeId: "alice", localShiftId: "s1" }, { workspaceId: "a", employeeId: "bob", localShiftId: "s1" }] };
    const manifest: TurnoSelectionManifestDto = { selectionVersion: 2, mode: "EMPLOYEES", manifestId: "duplicate", selectionDigest: "a".repeat(64), expiresAt: new Date(Date.now()+60000).toISOString(), context: request, formats: TURNO_EMPLOYEE_EXPORT_FORMATS, rows: [], omissions: [], blockers: [{ reason: "DUPLICATE_REGISTRATION", members: request.members, message: "Corrija as duas pessoas." }], counts: { found: 2, selected: 2, includedEmployees: 0, includedCodes: 0, txt1Lines: 0, txt2Lines: 0, omitted: 0, blockers: 1 } };
    expect(confirmManifest(manifest, request).blockers).toHaveLength(1);
    const rows = request.members.map(member => ({ ...member, registration: "0007", localShiftId: "s1", branchCode: "01", code: 1500, markings: entries[0].markings }));
    expect(() => confirmManifest({ ...manifest, rows, blockers: [], counts: { ...manifest.counts, includedEmployees: 2, includedCodes: 1, txt1Lines: 2, txt2Lines: 1, blockers: 0 } }, request)).toThrow(/duplicada/);
  });
});
