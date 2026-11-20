import { beforeEach, describe, expect, it, vi } from "vitest";
import { branchPermission, canCreateEscala, requireEscalaPermission, type EscalaActor } from "./access";
const db = vi.hoisted(() => ({ creation: vi.fn(), branch: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaBranchAccess: { findFirst: db.creation, findUnique: db.branch } } }));
const actor: EscalaActor = { userId: "operator", tenantId: "tenant-one", admin: false };
beforeEach(() => { vi.resetAllMocks(); db.creation.mockResolvedValue(null); });

describe("creation capability matches branch authorization", () => {
  it.each([{ ...actor, admin: true }, { ...actor, userId: null, moduleSessionId: "verified-module" }])("retains privileged scope without an extra grant query: %j", async value => {
    expect(await canCreateEscala(value)).toBe(true); expect(db.creation).not.toHaveBeenCalled();
  });
  it("denies an actor with no account identity or verified module session", async () => {
    expect(await canCreateEscala({ ...actor, userId: null })).toBe(false); expect(db.creation).not.toHaveBeenCalled();
  });
  it("queries only editable grants for this tenant and user", async () => {
    db.creation.mockResolvedValue({ branchCode: "07" });
    expect(await canCreateEscala(actor)).toBe(true);
    expect(db.creation).toHaveBeenCalledWith({ where: { tenantId: "tenant-one", userId: "operator", role: { in: ["PLANNER", "APPROVER"] } }, select: { branchCode: true } });
  });
  it("does not enable creation with only viewer, foreign or absent grants", async () => {
    expect(await canCreateEscala(actor)).toBe(false);
  });
  it.each(["VIEWER", "PLANNER", "APPROVER"])("keeps the actual %s branch gate and publication separate", async role => {
    db.creation.mockResolvedValue({ branchCode: "07" });
    db.branch.mockResolvedValue({ role });
    const permission = await branchPermission(actor, "7");
    expect(permission).toEqual({ canEdit: role !== "VIEWER", canPublish: role === "APPROVER" });
    expect(db.branch).toHaveBeenCalledWith({ where: { tenantId_userId_branchCode: { tenantId: "tenant-one", userId: "operator", branchCode: "07" } }, select: { role: true } });
    if (role === "VIEWER") expect(() => requireEscalaPermission(permission, "edit")).toThrow();
    else expect(() => requireEscalaPermission(permission, "edit")).not.toThrow();
    db.branch.mockResolvedValue(null);
    await expect(branchPermission(actor, "08")).rejects.toMatchObject({ code: "ESCALA_BRANCH_FORBIDDEN" });
  });
  it("fails closed when grant lookup is unavailable", async () => {
    db.creation.mockRejectedValue(new Error("synthetic database failure"));
    await expect(canCreateEscala(actor)).rejects.toThrow("synthetic database failure");
  });
});
