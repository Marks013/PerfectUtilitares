import type { AppSession } from "@/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ grants: vi.fn(), policy: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaBranchAccess: { findMany: mocks.grants }, escalaModuleAccessPolicy: { findUnique: mocks.policy } } }));
import { getEscalaAccountClientAccess } from "./account-access-view.server";
import { ESCALA_OPERATOR_CAPABILITIES } from "./permissions";

function account(overrides: Partial<AppSession["user"]> = {}): AppSession {
  return { user: { id: "user-1", tenantId: "tenant-1", role: "OPERATOR", status: "ACTIVE", name: "Private name", email: "private@example.test", ...overrides }, expires: "2030-01-01T00:00:00Z" };
}
function grant(branchCode: string, role = "PLANNER", ownership = {}) {
  return { tenantId: "tenant-1", userId: "user-1", branchCode, role, ...ownership };
}
beforeEach(() => { vi.resetAllMocks(); mocks.grants.mockResolvedValue([]); mocks.policy.mockResolvedValue({ mode: "SCOPED" }); });

describe("account client access display projection", () => {
  it("preserves full authenticated admin access without querying branch grants", async () => {
    mocks.grants.mockRejectedValue(new Error("database offline"));
    expect(await getEscalaAccountClientAccess(account({ role: "ADMIN" }))).toEqual({ channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] });
    expect(mocks.grants).not.toHaveBeenCalled();
  });
  it("projects canonical current grants with capabilities from the real policy and no private identity", async () => {
    mocks.grants.mockResolvedValue([grant("001", "VIEWER"), grant(" 2 "), grant("03", "APPROVER")]);
    const result = await getEscalaAccountClientAccess(account());
    expect(result).toEqual({ channel: "ACCOUNT", roleLabel: "Operador", administrator: false, allBranches: false, branches: [
      { code: "01", label: "Filial 01", capabilities: ["workspace.read", "export.schedule.pdf", "export.schedule.xlsx"] },
      { code: "02", label: "Filial 02", capabilities: [...ESCALA_OPERATOR_CAPABILITIES] },
      { code: "03", label: "Filial 03", capabilities: [...ESCALA_OPERATOR_CAPABILITIES, "workspace.publish"] },
    ] });
    expect(mocks.grants).toHaveBeenCalledWith({ where: { tenantId: "tenant-1", userId: "user-1" }, select: { tenantId: true, userId: true, branchCode: true, role: true } });
    for (const privateValue of ["tenant-1", "user-1", "Private name", "private@example.test"]) expect(JSON.stringify(result)).not.toContain(privateValue);
  });
  it("denies duplicated canonical branches, including a duplicate with an invalid role", async () => {
    mocks.grants.mockResolvedValue([grant("1"), grant("001", "INVALID"), grant("02")]);
    expect((await getEscalaAccountClientAccess(account()))?.branches.map(branch => branch.code)).toEqual(["02"]);
  });
  it("ignores foreign ownership, empty codes and invalid roles without inventing defaults", async () => {
    mocks.grants.mockResolvedValue([grant("01", "APPROVER", { tenantId: "foreign" }), grant("02", "PLANNER", { userId: "foreign" }), grant(" "), grant("03", "ADMIN")]);
    expect(await getEscalaAccountClientAccess(account())).toEqual({ channel: "ACCOUNT", roleLabel: "Operador", administrator: false, allBranches: false, branches: [] });
  });
  it("denies blocked, banned, absent and invalid tenant identities before querying", async () => {
    for (const session of [null, account({ status: "BLOCKED" }), account({ status: "BANNED", role: "ADMIN" }), account({ tenantId: null }), account({ tenantId: " " }), account({ id: "" })]) {
      expect(await getEscalaAccountClientAccess(session)).toBeNull();
    }
    expect(mocks.grants).not.toHaveBeenCalled();
  });
  it("propagates database failure without granting an administrative fallback", async () => {
    mocks.grants.mockRejectedValue(new Error("database offline"));
    await expect(getEscalaAccountClientAccess(account())).rejects.toThrow("database offline");
  });
});
