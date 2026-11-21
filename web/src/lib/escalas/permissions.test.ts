import { describe, expect, it } from "vitest";
import {
  decideEscalaPermission, ESCALA_CAPABILITIES, ESCALA_OPERATOR_CAPABILITIES,
  resolveEscalaExportProjection, selectEscalaPrincipal,
  type EscalaPermissionContext, type EscalaPrincipal,
} from "./permissions";

type Account = Extract<EscalaPrincipal, { kind: "account" }>;
type Operator = Extract<EscalaPrincipal, { kind: "operator" }>;
const account = (role = "VIEWER", branchCode = "01"): Account => ({
  kind: "account", id: "account-a", tenantId: "tenant-a", status: "ACTIVE", role: "OPERATOR",
  branchGrants: [{ tenantId: "tenant-a", userId: "account-a", branchCode, role }],
});
const operator = (capabilities: readonly string[] = ESCALA_OPERATOR_CAPABILITIES): Operator => ({
  kind: "operator", id: "operator-a", tenantId: "tenant-a", active: true,
  branchGrants: [{ tenantId: "tenant-a", operatorId: "operator-a", branchCode: "01", active: true, capabilities }],
});
const admin = (): Account => ({ ...account(), role: "ADMIN", branchGrants: [] });
const context = (principal: EscalaPrincipal | null, overrides: Partial<EscalaPermissionContext> = {}): EscalaPermissionContext => ({
  mode: "SCOPED", tenantId: "tenant-a", branchCode: "01", principal, ...overrides,
});
const allowed = (principal: EscalaPrincipal | null, capability: string, overrides: Partial<EscalaPermissionContext> = {}) =>
  decideEscalaPermission(context(principal, overrides), capability).allowed;

describe("Escalas permission foundation (not connected to live access)", () => {
  it("preserves all known administrative actions in the authorized tenant", () => {
    for (const capability of ESCALA_CAPABILITIES) {
      expect(allowed(admin(), capability)).toBe(true);
      expect(allowed(admin(), capability, { mode: "ADMIN_ONLY", branchCode: undefined })).toBe(true);
      expect(allowed(admin(), capability, { tenantId: "tenant-b" })).toBe(false);
    }
  });

  it("denies unknown actions and modes even for administrators", () => {
    expect(decideEscalaPermission(context(admin()), "settings.future")).toEqual({ allowed: false, reason: "UNKNOWN_CAPABILITY" });
    for (const mode of ["", "LEGACY", "unknown"]) expect(allowed(admin(), "workspace.read", { mode })).toBe(false);
  });

  it("requires an active server-resolved identity", () => {
    expect(decideEscalaPermission(context(null), "workspace.read").allowed).toBe(false);
    for (const principal of [
      { ...admin(), status: "BLOCKED" }, { ...admin(), status: "BANNED" },
      { ...admin(), status: "unknown" }, { ...operator(), active: false },
      { ...operator(), id: "" }, { ...account(), role: "UNKNOWN" },
    ]) expect(allowed(principal, "workspace.read")).toBe(false);
  });

  it("keeps ADMIN_ONLY closed for every non-administrative channel and legacy role", () => {
    for (const principal of [account("VIEWER"), account("PLANNER"), account("APPROVER"), operator()]) {
      for (const capability of ESCALA_CAPABILITIES) expect(allowed(principal, capability, { mode: "ADMIN_ONLY" })).toBe(false);
    }
  });

  it("allows the configured operator work and basic downloads only in the granted branch", () => {
    const principal = operator();
    for (const capability of ESCALA_OPERATOR_CAPABILITIES) {
      expect(allowed(principal, capability)).toBe(true);
      expect(allowed(principal, capability, { branchCode: "02" })).toBe(false);
      expect(allowed(principal, capability, { tenantId: "tenant-b" })).toBe(false);
      expect(allowed(principal, capability, { branchCode: undefined })).toBe(false);
    }
  });

  it("uses the existing numeric branch identity without broadening textual branch names", () => {
    expect(allowed(operator(), "workspace.read", { branchCode: " 001 " })).toBe(true);
    const principal = account("VIEWER", "A01");
    expect(allowed(principal, "workspace.read", { branchCode: " A01 " })).toBe(true);
    expect(allowed(principal, "workspace.read", { branchCode: "a01" })).toBe(false);
    expect(allowed(principal, "workspace.read", { branchCode: "01" })).toBe(false);
  });

  it("does not infer a grant from a session, tenant membership or an empty capability list", () => {
    expect(allowed({ ...operator(), branchGrants: [] }, "workspace.read")).toBe(false);
    expect(allowed({ ...account("PLANNER"), branchGrants: [] }, "workspace.save")).toBe(false);
    expect(allowed(operator([]), "workspace.read")).toBe(false);
    expect(allowed(operator(["schedule.generate"]), "schedule.generate")).toBe(true);
    expect(allowed(operator(["schedule.generate"]), "workspace.save")).toBe(false);
  });

  it("rejects privileged capabilities injected into an operator grant", () => {
    const principal = operator(ESCALA_CAPABILITIES);
    for (const capability of ["workspace.publish", "workspace.delete", "import.manage", "export.integration", "report.analytics", "settings.manage", "access.manage"]) {
      expect(allowed(principal, capability)).toBe(false);
    }
    expect(allowed({ ...principal, role: "ADMIN" } as Operator, "access.manage")).toBe(false);
  });

  it("does not union grants from other people, tenants or branches", () => {
    const principal = operator([]);
    const grant = operator().branchGrants[0];
    const polluted: Operator = { ...principal, branchGrants: [
      ...principal.branchGrants, { ...grant, operatorId: "someone-else" },
      { ...grant, tenantId: "tenant-b" }, { ...grant, branchCode: "02" },
    ] };
    expect(allowed(polluted, "workspace.save")).toBe(false);
    const viewer = account();
    const elevated = { ...viewer.branchGrants[0], role: "APPROVER" };
    expect(allowed({ ...viewer, branchGrants: [
      ...viewer.branchGrants, { ...elevated, userId: "someone-else" }, { ...elevated, tenantId: "tenant-b" },
    ] }, "workspace.publish")).toBe(false);
  });

  it("rejects ambiguous canonical grants instead of choosing the most privileged one", () => {
    const principal = account();
    expect(decideEscalaPermission(context({ ...principal, branchGrants: [
      ...principal.branchGrants, { ...principal.branchGrants[0], branchCode: "001", role: "APPROVER" },
    ] }), "workspace.publish")).toEqual({ allowed: false, reason: "AMBIGUOUS_GRANT" });
    const op = operator();
    expect(allowed({ ...op, branchGrants: [...op.branchGrants, { ...op.branchGrants[0], active: false }] }, "workspace.save")).toBe(false);
  });

  it("honors revocation and capability removal on the next decision without a local permission cache", () => {
    const principal = operator();
    expect(allowed(principal, "workspace.save")).toBe(true);
    expect(allowed({ ...principal, branchGrants: [{ ...principal.branchGrants[0], active: false }] }, "workspace.save")).toBe(false);
    expect(allowed(operator(["workspace.read"]), "workspace.save")).toBe(false);
  });

  it("keeps legacy VIEWER read-only while retaining both basic formats", () => {
    const viewer = account("VIEWER");
    for (const capability of ["workspace.read", "export.schedule.pdf", "export.schedule.xlsx"]) expect(allowed(viewer, capability)).toBe(true);
    for (const capability of ["workspace.create", "workspace.save", "schedule.generate", "employee.manage", "shift.manage", "workspace.publish"]) {
      expect(allowed(viewer, capability)).toBe(false);
    }
  });

  it("maps PLANNER operational actions without legacy administrative privileges", () => {
    const planner = account("PLANNER");
    for (const capability of ESCALA_OPERATOR_CAPABILITIES) expect(allowed(planner, capability)).toBe(true);
    for (const capability of ["workspace.publish", "workspace.delete", "import.manage", "export.integration", "report.analytics", "settings.manage", "access.manage"]) {
      expect(allowed(planner, capability)).toBe(false);
    }
  });

  it("preserves APPROVER publication only in the branch carrying that exact legacy grant", () => {
    const principal = account("APPROVER");
    const viewer = { ...principal.branchGrants[0], branchCode: "02", role: "VIEWER" };
    const scoped = { ...principal, branchGrants: [...principal.branchGrants, viewer] };
    expect(allowed(scoped, "workspace.publish")).toBe(true);
    expect(allowed(scoped, "workspace.publish", { branchCode: "02" })).toBe(false);
    expect(allowed(scoped, "workspace.save", { branchCode: "02" })).toBe(false);
    for (const capability of ["workspace.delete", "import.manage", "export.integration", "report.analytics", "settings.manage", "access.manage"]) {
      expect(allowed(scoped, capability)).toBe(false);
    }
  });

  it("fails closed for an unknown legacy branch role, including a forged ADMIN branch grant", () => {
    for (const role of ["ADMIN", "UNKNOWN", "", "planner"]) expect(allowed(account(role), "workspace.read")).toBe(false);
  });

  it("keeps account precedence without merging or falling back to an operator cookie", () => {
    const op = operator();
    const viewer = account("VIEWER");
    expect(selectEscalaPrincipal(viewer, op)).toBe(viewer);
    expect(allowed(selectEscalaPrincipal(viewer, op), "workspace.save")).toBe(false);
    const blocked = { ...viewer, status: "BLOCKED" };
    expect(allowed(selectEscalaPrincipal(blocked, op), "workspace.read")).toBe(false);
    const unbound = { ...viewer, branchGrants: [] };
    expect(allowed(selectEscalaPrincipal(unbound, op), "workspace.read")).toBe(false);
    expect(selectEscalaPrincipal(null, op)).toBe(op);
    expect(selectEscalaPrincipal(null, null)).toBeNull();
  });

  it.each(["pdf", "xlsx"])("permits only basic %s for all non-administrators", format => {
    for (const principal of [operator(), account("VIEWER"), account("PLANNER"), account("APPROVER")]) {
      expect(resolveEscalaExportProjection(context(principal), format)).toBe("BASIC_SCHEDULE");
      expect(resolveEscalaExportProjection(context(principal), format, "ADMIN_FULL")).toBeNull();
      expect(resolveEscalaExportProjection(context(principal, { branchCode: "02" }), format)).toBeNull();
    }
    expect(resolveEscalaExportProjection(context(admin()), format, "ADMIN_FULL")).toBe("ADMIN_FULL");
    expect(resolveEscalaExportProjection(context(admin()), format, "BASIC_SCHEDULE")).toBe("BASIC_SCHEDULE");
  });

  it("rejects unknown formats/projections and disabled downloads without administrative fallback", () => {
    expect(resolveEscalaExportProjection(context(admin()), "txt")).toBeNull();
    expect(resolveEscalaExportProjection(context(admin()), "pdf", "admin")).toBeNull();
    expect(resolveEscalaExportProjection(context(operator([])), "pdf")).toBeNull();
    expect(resolveEscalaExportProjection(context(operator(), { mode: "ADMIN_ONLY" }), "xlsx")).toBeNull();
  });

  it("does not mutate grants while evaluating capabilities and projections", () => {
    const principal = operator();
    const before = structuredClone(principal);
    for (const capability of ESCALA_CAPABILITIES) decideEscalaPermission(context(principal), capability);
    resolveEscalaExportProjection(context(principal), "pdf", "ADMIN_FULL");
    expect(principal).toEqual(before);
    expect(Object.isFrozen(ESCALA_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(ESCALA_OPERATOR_CAPABILITIES)).toBe(true);
  });
});
