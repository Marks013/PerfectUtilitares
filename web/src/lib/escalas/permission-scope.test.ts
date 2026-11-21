import { describe, expect, it } from "vitest";
import { ESCALA_CAPABILITIES, type EscalaPrincipal } from "./permissions";
import { resolveEscalaPermissionScope } from "./permission-scope";

type Account = Extract<EscalaPrincipal, { kind: "account" }>;
type Operator = Extract<EscalaPrincipal, { kind: "operator" }>;
const account = (): Account => ({ kind: "account", id: "account-a", tenantId: "tenant-a", role: "OPERATOR", status: "ACTIVE", branchGrants: [
  { tenantId: "tenant-a", userId: "account-a", branchCode: "01", role: "VIEWER" },
  { tenantId: "tenant-a", userId: "account-a", branchCode: "002", role: "PLANNER" },
  { tenantId: "tenant-a", userId: "account-a", branchCode: "03", role: "APPROVER" },
] });
const operator = (): Operator => ({ kind: "operator", id: "person-a", tenantId: "tenant-a", active: true, branchGrants: [
  { tenantId: "tenant-a", operatorId: "person-a", branchCode: "02", active: true, capabilities: ["workspace.read", "workspace.save"] },
  { tenantId: "tenant-a", operatorId: "person-a", branchCode: "001", active: true, capabilities: ["workspace.read"] },
  { tenantId: "tenant-a", operatorId: "person-a", branchCode: "03", active: false, capabilities: ["workspace.read"] },
] });
const scope = (principal: EscalaPrincipal | null, capability = "workspace.read", mode = "SCOPED", tenantId = "tenant-a") =>
  resolveEscalaPermissionScope({ principal, tenantId, mode }, capability);
const branches = (...branchCodes: string[]) => ({ kind: "branches", tenantId: "tenant-a", branchCodes });

describe("explicit collection scope by effective capability", () => {
  it("reserves all-branch access for an active administrator within the canonical tenant", () => {
    const admin = { ...account(), role: "ADMIN", branchGrants: [] };
    for (const capability of ESCALA_CAPABILITIES) {
      expect(scope(admin, capability)).toEqual({ kind: "all", tenantId: "tenant-a" });
      expect(scope(admin, capability, "ADMIN_ONLY")).toEqual({ kind: "all", tenantId: "tenant-a" });
      expect(scope(admin, capability, "SCOPED", "tenant-b")).toEqual({ kind: "none" });
    }
    expect(scope(admin, "future.action")).toEqual({ kind: "none" });
  });

  it("returns canonical branches separately for each legacy capability", () => {
    expect(scope(account())).toEqual(branches("01", "02", "03"));
    expect(scope(account(), "workspace.save")).toEqual(branches("02", "03"));
    expect(scope(account(), "workspace.publish")).toEqual(branches("03"));
    expect(scope(account(), "import.manage")).toEqual({ kind: "none" });
  });

  it("filters inactive and capability-specific operator grants", () => {
    expect(scope(operator())).toEqual(branches("01", "02"));
    expect(scope(operator(), "workspace.save")).toEqual(branches("02"));
    expect(scope(operator(), "export.schedule.pdf")).toEqual({ kind: "none" });
  });

  it("never interprets absent, empty, inactive or unknown identities as unrestricted", () => {
    for (const principal of [null, { ...account(), branchGrants: [] }, { ...operator(), branchGrants: [] },
      { ...account(), status: "BLOCKED" }, { ...account(), role: "UNKNOWN" }, { ...operator(), active: false }]) {
      expect(scope(principal)).toEqual({ kind: "none" });
    }
  });

  it("honors the access mode for every non-administrative profile", () => {
    for (const mode of ["ADMIN_ONLY", "LEGACY", "UNKNOWN", ""]) {
      expect(scope(account(), "workspace.read", mode)).toEqual({ kind: "none" });
      expect(scope(operator(), "workspace.read", mode)).toEqual({ kind: "none" });
    }
    expect(scope({ ...account(), role: "ADMIN" }, "workspace.read", "LEGACY")).toEqual({ kind: "none" });
  });

  it("ignores grants belonging to other people or tenants without widening the collection", () => {
    const a = account(), op = operator();
    expect(scope({ ...a, branchGrants: [...a.branchGrants,
      { tenantId: "tenant-b", userId: a.id, branchCode: "99", role: "APPROVER" },
      { tenantId: "tenant-a", userId: "another", branchCode: "01", role: "APPROVER" },
    ] })).toEqual(branches("01", "02", "03"));
    expect(scope({ ...op, branchGrants: [...op.branchGrants,
      { ...op.branchGrants[0], tenantId: "tenant-b", branchCode: "99" },
      { ...op.branchGrants[0], operatorId: "another", branchCode: "01" },
    ] })).toEqual(branches("01", "02"));
  });

  it("denies an ambiguous branch without losing unrelated legitimate grants", () => {
    const a = account(), op = operator();
    expect(scope({ ...a, branchGrants: [...a.branchGrants,
      { ...a.branchGrants[0], branchCode: "001", role: "APPROVER" },
      { ...a.branchGrants[0], branchCode: "0001", role: "PLANNER" },
    ] })).toEqual(branches("02", "03"));
    expect(scope({ ...op, branchGrants: [...op.branchGrants, { ...op.branchGrants[0], branchCode: "002", active: false }] }))
      .toEqual(branches("01"));
  });

  it("preserves textual branch identity and rejects empty branch codes", () => {
    const op = operator(), grant = op.branchGrants[0];
    expect(scope({ ...op, branchGrants: [
      { ...grant, branchCode: " A01 " }, { ...grant, branchCode: "a01" }, { ...grant, branchCode: "  " },
    ] })).toEqual(branches("A01", "a01"));
  });

  it("does not elevate a forged administrative capability or role in a branch grant", () => {
    const op = operator(), a = account();
    expect(scope({ ...op, branchGrants: [{ ...op.branchGrants[0], capabilities: ESCALA_CAPABILITIES }] }, "access.manage"))
      .toEqual({ kind: "none" });
    expect(scope({ ...a, branchGrants: [{ ...a.branchGrants[0], role: "ADMIN" }] })).toEqual({ kind: "none" });
  });

  it("does not mutate grants and freezes the returned collection", () => {
    const principal = operator(), before = JSON.stringify(principal);
    const result = scope(principal);
    expect(JSON.stringify(principal)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind !== "branches") throw new Error("Expected limited collection");
    expect(Object.isFrozen(result.branchCodes)).toBe(true);
  });
});
