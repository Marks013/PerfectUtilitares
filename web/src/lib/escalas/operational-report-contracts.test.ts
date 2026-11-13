import { describe, expect, it } from "vitest";
import { OPERATIONAL_REPORT_PATH, OPERATIONAL_REPORT_METHOD, OPERATIONAL_REPORT_PRESETS, operationalReportOptionsSchema,
  parseOperationalReportQuery, serializeOperationalReportQuery, operationalReportCapabilities, validateOperationalReportSelection,
  type OperationalReportContext } from "./operational-report-contracts";

const options = { workspaceId: "synthetic-workspace", revision: 19, month: "2026-12", sections: ["journeys"] as const };
const input = () => ({ ...options, sections: [...options.sections] });
const context: OperationalReportContext = { workspaceId: options.workspaceId, revision: 19, visibleMonth: "2026-12", generationMode: "DAYS_AND_HOURS", hasRoster: true, sectors: ["Setor & A", "Setor B"] };

describe("operational PDF options shared by browser and server", () => {
  it("defines a separate GET PDF contract and explicit local presets", () => {
    expect(OPERATIONAL_REPORT_PATH).toBe("/api/escalas/operational-report"); expect(OPERATIONAL_REPORT_METHOD).toBe("GET");
    expect(operationalReportOptionsSchema.parse(input()).format).toBe("pdf");
    expect(OPERATIONAL_REPORT_PRESETS.references.sections).toEqual(["journeys", "variants"]);
    expect(operationalReportOptionsSchema.safeParse({ ...input(), format: "xlsx" }).success).toBe(false);
    expect(operationalReportOptionsSchema.safeParse({ ...input(), save: true }).success).toBe(false);
  });
  it("round-trips repeated selections deterministically without modifying preferences", () => {
    const value = { ...input(), sections: ["variants", "journeys", "journeys"], sectors: ["Setor B", "Setor & A", "Setor B"] };
    const before = structuredClone(value);
    const query = serializeOperationalReportQuery({ ...value, sections: ["variants", "journeys", "journeys"] });
    const parsed = parseOperationalReportQuery(new URLSearchParams(query));
    if (!parsed.success) throw new Error("Serialized options must parse");
    expect(parsed.data.sections).toEqual(["journeys", "variants"]); expect(parsed.data.sectors).toEqual(["Setor & A", "Setor B"]);
    expect(serializeOperationalReportQuery(parsed.data)).toBe(query); expect(value).toEqual(before);
    expect(validateOperationalReportSelection(parsed.data, context)).toEqual([]);
  });
  it.each([0, -1, 1.5, 2_000_000_001, undefined])("requires a valid expected revision: %s", revision => {
    expect(operationalReportOptionsSchema.safeParse({ ...input(), revision }).success).toBe(false);
  });
  it("rejects ambiguous scalars, unknown query controls and malformed sector values", () => {
    const valid = serializeOperationalReportQuery(input());
    for (const suffix of ["&revision=20", "&format=xlsx", "&solver=true", "&sector=", "&sector=%00"]) {
      expect(parseOperationalReportQuery(new URLSearchParams(valid + suffix)).success).toBe(false);
    }
    expect(operationalReportOptionsSchema.safeParse({ ...input(), sections: [] }).success).toBe(false);
  });
  it("validates civil dates and requires an explicit map day, never a horizon fallback", () => {
    expect(operationalReportOptionsSchema.safeParse({ ...input(), sections: ["presence"] }).success).toBe(false);
    for (const date of ["2026-11-30", "2026-12-32", "2026-12-00", "2026-12-01T00:00:00Z"]) {
      expect(operationalReportOptionsSchema.safeParse({ ...input(), sections: ["presence"], date }).success).toBe(false);
    }
    expect(operationalReportOptionsSchema.safeParse({ ...input(), month: "2028-02", sections: ["presence"], date: "2028-02-29" }).success).toBe(true);
    expect(operationalReportOptionsSchema.safeParse({ ...input(), month: "2027-02", date: "2027-02-29" }).success).toBe(false);
    expect(operationalReportOptionsSchema.parse({ ...input(), sections: ["coverage"] }).date).toBeUndefined();
  });
  it.each(["REST_ONLY", "DAYS_AND_HOURS", "HOURS_ONLY"] as const)("permits references only without a roster in %s", generationMode => {
    const empty = { ...context, generationMode, hasRoster: false };
    expect(operationalReportCapabilities(generationMode, false).sections).toEqual(["journeys", "variants"]);
    expect(validateOperationalReportSelection(operationalReportOptionsSchema.parse(input()), empty)).toEqual([]);
    for (const section of ["summary", "calendar", "presence", "coverage"] as const) {
      const value = operationalReportOptionsSchema.parse({ ...input(), sections: [section], ...(section === "presence" ? { date: "2026-12-01" } : {}) });
      expect(validateOperationalReportSelection(value, empty).some(issue => issue.field === "sections")).toBe(true);
    }
    expect(operationalReportCapabilities(generationMode, true).sections).toContain("presence");
  });
  it("binds options to the saved workspace, expected revision, visible month and available sectors", () => {
    const value = operationalReportOptionsSchema.parse({ ...input(), sectors: ["Other sector"] });
    expect(validateOperationalReportSelection(value, { ...context, workspaceId: "different", revision: 20, visibleMonth: "2026-11" }).map(issue => issue.field))
      .toEqual(["workspaceId", "revision", "month", "sectors"]);
  });
});
