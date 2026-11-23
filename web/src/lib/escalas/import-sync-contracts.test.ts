import { describe, expect, it } from "vitest";
import { importSyncCommandSchema, importSyncLayoutSchema } from "./import-sync-contracts";
const preview = { action: "PREVIEW_REPLACE", purpose: "EMPLOYEES", workspaceId: "w1", expectedRevision: "1",
  startDate: "2026-11-30", endDate: "2027-01-03", completeScopeConfirmed: true };
describe("administrative replacement contract", () => {
  it("represents each supported layout and a blocked unrecognized source", () => {
    for (const layout of ["ESCALA_TEMPLATE", "FPRE136", "FPHI105", "UNRECOGNIZED"]) expect(importSyncLayoutSchema.parse(layout)).toBe(layout);
    expect(importSyncLayoutSchema.safeParse("CSV").success).toBe(false);
  });
  it.each(["EMPLOYEES", "ABSENCES"])("admits bounded preview/apply metadata for %s", purpose => {
    expect(importSyncCommandSchema.parse({ ...preview, purpose }).expectedRevision).toBe(1);
    expect(importSyncCommandSchema.safeParse({ ...preview, purpose, action: "APPLY_REPLACE", confirm: true, expectedImpactHash: "a".repeat(64) }).success).toBe(true);
    expect(importSyncCommandSchema.parse({ ...preview, purpose, completeScopeConfirmed: undefined }).completeScopeConfirmed).toBe(false);
  });
  it("requires an explicit complete scope, confirmation and impact for APPLY", () => {
    for (const patch of [{ confirm: undefined }, { completeScopeConfirmed: false }, { confirm: false }, { expectedImpactHash: "invalid" }]) {
      expect(importSyncCommandSchema.safeParse({ ...preview, action: "APPLY_REPLACE", confirm: true, expectedImpactHash: "a".repeat(64), ...patch }).success).toBe(false);
    }
  });
  it("accepts textual corrections only for one employee row at a time and never for absences", () => {
    const correction = { line: 8, registration: "0007" };
    expect(importSyncCommandSchema.parse({ ...preview, registrationCorrections: [correction] }).registrationCorrections).toEqual([correction]);
    for (const registrationCorrections of [
      [correction, { ...correction, registration: "0008" }],
      [{ ...correction, line: 1 }],
      [{ ...correction, registration: 7 }],
      [{ ...correction, registration: "\t" }],
      Array.from({ length: 251 }, (_, index) => ({ ...correction, line: index + 2 })),
    ]) expect(importSyncCommandSchema.safeParse({ ...preview, registrationCorrections }).success).toBe(false);
    expect(importSyncCommandSchema.safeParse({ ...preview, purpose: "ABSENCES", registrationCorrections: [correction] }).success).toBe(false);
  });
  it("rejects browser authority, free SAVE flags and malformed or oversized context", () => {
    for (const patch of [{ tenantId: "other" }, { employees: [] }, { approvedPolicyVersionId: "other" }, { force: true },
      { startDate: "2026-02-30" }, { endDate: "2027-01-20" }, { expectedRevision: 0 }, { workspaceId: "x".repeat(101) }]) {
      expect(importSyncCommandSchema.safeParse({ ...preview, ...patch }).success).toBe(false);
    }
  });
});
