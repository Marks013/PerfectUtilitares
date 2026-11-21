import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteEscala } from "./service";

const mocks = vi.hoisted(() => ({ row: vi.fn(), revisions: vi.fn(), peers: vi.fn(), deleteVersions: vi.fn(), deleteWorkspace: vi.fn(),
  audit: vi.fn(), transaction: vi.fn(), grants: vi.fn(), lock: vi.fn(), accountLock: vi.fn(), approvalOrigins: vi.fn(),
  user: vi.fn(), policy: vi.fn() }));
const accessTables = vi.hoisted(() => ({
  escalaModuleAccessPolicy: { findUnique: mocks.policy },
  user: { findFirst: mocks.user },
  escalaBranchAccess: { findMany: mocks.grants },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  ...accessTables, escalaWorkspace: { findFirst: mocks.row },
  $transaction: mocks.transaction,
} }));
const actor = { tenantId: "tenant-a", userId: "actor-a", admin: true };
const operator = { ...actor, userId: "operator-a", admin: false };
const row = { id: "w", tenantId: "tenant-a", branchCode: "08", branchName: "Filial sintética", revision: 2, status: "DRAFT", startDate: "2026-10-26", endDate: "2026-12-06" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.policy.mockResolvedValue({ mode: "SCOPED" });
  mocks.user.mockImplementation(async ({ where }: { where: { id: string; tenantId: string } }) => {
    if (where.tenantId !== actor.tenantId || ![actor.userId, operator.userId].includes(where.id)) return null;
    return { ...where, status: "ACTIVE", role: where.id === actor.userId ? "ADMIN" : "OPERATOR", securityVersion: 1 };
  });
  mocks.grants.mockResolvedValue([]);
  mocks.row.mockResolvedValue(row);
  mocks.revisions.mockResolvedValue(null);
  mocks.peers.mockResolvedValue([]);
  mocks.approvalOrigins.mockResolvedValue(0);
  mocks.deleteVersions.mockResolvedValue({ count: 2 });
  mocks.deleteWorkspace.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(callback => callback({
    ...accessTables, $executeRaw: mocks.lock, $queryRaw: mocks.accountLock,
    escalaWorkspace: { findFirst: mocks.row, findMany: mocks.peers, deleteMany: mocks.deleteWorkspace },
    escalaRevision: { findFirst: mocks.revisions, deleteMany: mocks.deleteVersions }, auditLog: { create: mocks.audit },
    escalaBranchPolicyVersion: { count: mocks.approvalOrigins },
  }));
});
describe("safe planning deletion", () => {
  it("deletes revisions before workspace in one transaction, scoped by tenant and expected revision", async () => {
    expect(await deleteEscala(actor, "w", 2)).toEqual({ deletedId: "w" });
    expect(mocks.deleteVersions).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", workspaceId: "w" } });
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: "w", revision: 2 } });
    expect(mocks.deleteVersions.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteWorkspace.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "DELETE", entity: "EscalaWorkspace", entityId: "w" }) }));
    expect(mocks.lock.mock.calls.map(([, key]) => key)).toEqual(["escala-access:tenant-a", 'escalas-publication:["tenant-a","08"]']);
    expect(mocks.accountLock).toHaveBeenCalledOnce();
  });
  it("refuses an absent tenant record, a viewer, and a stale revision without deletion", async () => {
    mocks.row.mockResolvedValueOnce(null);
    await expect(deleteEscala(actor, "foreign", 2)).rejects.toMatchObject({ status: 404 });
    mocks.grants.mockResolvedValue([{ tenantId: actor.tenantId, userId: operator.userId, branchCode: row.branchCode, role: "VIEWER" }]);
    await expect(deleteEscala(operator, "w", 2)).rejects.toMatchObject({ code: "ESCALA_ACTION_FORBIDDEN", status: 403 });
    await expect(deleteEscala(actor, "w", 1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
  });
  it("refuses published dependency and preserves revisions even when current revision is draft", async () => {
    mocks.revisions.mockResolvedValue({ revision: 1 });
    mocks.peers.mockResolvedValue([{ id: "next", startDate: "2026-11-30" }]);
    await expect(deleteEscala(actor, "w", 2)).rejects.toMatchObject({ code: "ESCALA_DELETE_DEPENDENCY", status: 409 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
  });
  it("allows an administrator to delete an isolated published plan but denies planners and approvers", async () => {
    mocks.revisions.mockResolvedValue({ revision: 1 });
    for (const role of ["PLANNER", "APPROVER"]) {
      mocks.grants.mockResolvedValue([{ tenantId: actor.tenantId, userId: operator.userId, branchCode: row.branchCode, role }]);
      await expect(deleteEscala(operator, "w", 2)).rejects.toMatchObject({ code: "ESCALA_ACTION_FORBIDDEN", status: 403 });
    }
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
    expect(await deleteEscala(actor, "w", 2)).toEqual({ deletedId: "w" });
  });
  it("retains the origin of an approved policy even when it was never published", async () => {
    mocks.approvalOrigins.mockResolvedValue(1);
    await expect(deleteEscala(actor, "w", 2)).rejects.toMatchObject({ code: "ESCALA_DELETE_DEPENDENCY", status: 409 });
    expect(mocks.approvalOrigins).toHaveBeenCalledWith({ where: { tenantId: actor.tenantId, originWorkspaceId: "w" } });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
  });
  it("checks revision again inside the transaction and aborts on a competing save", async () => {
    mocks.row.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, revision: 3 });
    await expect(deleteEscala(actor, "w", 2)).rejects.toMatchObject({ status: 409 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
  });
});
