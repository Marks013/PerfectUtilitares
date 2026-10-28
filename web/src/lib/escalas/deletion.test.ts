import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteEscala } from "./service";

const mocks = vi.hoisted(() => ({ row: vi.fn(), revisions: vi.fn(), peers: vi.fn(), deleteVersions: vi.fn(), deleteWorkspace: vi.fn(), audit: vi.fn(), transaction: vi.fn(), grant: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  escalaWorkspace: { findFirst: mocks.row }, escalaBranchAccess: { findUnique: mocks.grant },
  $transaction: mocks.transaction,
} }));
const actor = { tenantId: "tenant-a", userId: "actor-a", admin: true };
const row = { id: "w", tenantId: "tenant-a", branchCode: "08", branchName: "Filial sintética", revision: 2, status: "DRAFT", startDate: "2026-10-26", endDate: "2026-12-06" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.row.mockResolvedValue(row);
  mocks.revisions.mockResolvedValue(null);
  mocks.peers.mockResolvedValue([]);
  mocks.deleteVersions.mockResolvedValue({ count: 2 });
  mocks.deleteWorkspace.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(callback => callback({
    $executeRaw: mocks.lock,
    escalaWorkspace: { findFirst: mocks.row, findMany: mocks.peers, deleteMany: mocks.deleteWorkspace },
    escalaRevision: { findFirst: mocks.revisions, deleteMany: mocks.deleteVersions }, auditLog: { create: mocks.audit },
  }));
});
describe("safe planning deletion", () => {
  it("deletes revisions before workspace in one transaction, scoped by tenant and expected revision", async () => {
    expect(await deleteEscala(actor, "w", 2)).toEqual({ deletedId: "w" });
    expect(mocks.deleteVersions).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", workspaceId: "w" } });
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", id: "w", revision: 2 } });
    expect(mocks.deleteVersions.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteWorkspace.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "DELETE", entity: "EscalaWorkspace", entityId: "w" }) }));
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it("refuses an absent tenant record, a viewer, and a stale revision without deletion", async () => {
    mocks.row.mockResolvedValueOnce(null);
    await expect(deleteEscala(actor, "foreign", 2)).rejects.toMatchObject({ status: 404 });
    mocks.grant.mockResolvedValue({ role: "VIEWER" });
    await expect(deleteEscala({ ...actor, admin: false }, "w", 2)).rejects.toMatchObject({ status: 403 });
    await expect(deleteEscala(actor, "w", 1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
  });
  it("refuses published dependency and preserves revisions even when current revision is draft", async () => {
    mocks.revisions.mockResolvedValue({ revision: 1 });
    mocks.peers.mockResolvedValue([{ id: "next", startDate: "2026-11-30" }]);
    await expect(deleteEscala(actor, "w", 2)).rejects.toMatchObject({ code: "ESCALA_DELETE_DEPENDENCY", status: 409 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
  });
  it("allows an isolated published plan only for a publisher", async () => {
    mocks.revisions.mockResolvedValue({ revision: 1 });
    mocks.grant.mockResolvedValue({ role: "PLANNER" });
    await expect(deleteEscala({ ...actor, admin: false }, "w", 2)).rejects.toMatchObject({ status: 403 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
    expect(await deleteEscala(actor, "w", 2)).toEqual({ deletedId: "w" });
  });
  it("checks revision again inside the transaction and aborts on a competing save", async () => {
    mocks.row.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, revision: 3 });
    await expect(deleteEscala(actor, "w", 2)).rejects.toMatchObject({ status: 409 });
    expect(mocks.deleteVersions).not.toHaveBeenCalled();
  });
});
