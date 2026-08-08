import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  ensureBootstrapAdmin,
  validateBootstrapAdminPassword,
} from "./seed-admin";

const existingAdmin = {
  id: "admin-1",
  tenantId: "tenant-1",
  email: "admin@example.test",
  name: "Administrador atual",
  passwordHash: "existing-hash",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function prismaMock(existing: typeof existingAdmin | null = existingAdmin) {
  const findUnique = vi.fn(async () => existing);
  const create = vi.fn();
  return {
    create,
    findUnique,
    prisma: { user: { create, findUnique } } as unknown as Pick<
      PrismaClient,
      "user"
    >,
  };
}

describe("bootstrap administrator", () => {
  it("preserves every field of an existing administrator", async () => {
    const mocks = prismaMock();
    const hashPassword = vi.fn();

    const result = await ensureBootstrapAdmin(mocks.prisma, {
      email: existingAdmin.email,
      tenantId: "different-tenant",
      hashPassword,
    });

    expect(result).toEqual({ created: false, user: existingAdmin });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("requires a strong password only when creating the initial administrator", async () => {
    const mocks = prismaMock(null);

    await expect(
      ensureBootstrapAdmin(mocks.prisma, {
        email: existingAdmin.email,
        tenantId: existingAdmin.tenantId,
      }),
    ).rejects.toThrow("ADMIN_PASSWORD é obrigatório");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["admin123", "short", "perfectutilitares"])(
    "rejects predictable bootstrap password %s",
    (password) => {
      expect(() => validateBootstrapAdminPassword(password)).toThrow();
    },
  );

  it("creates the initial administrator without a later update path", async () => {
    const mocks = prismaMock(null);
    const hashPassword = vi.fn(async () => "new-secure-hash");
    mocks.create.mockResolvedValue(existingAdmin);

    const result = await ensureBootstrapAdmin(mocks.prisma, {
      email: existingAdmin.email,
      password: "a-secure-bootstrap-password-2026",
      tenantId: existingAdmin.tenantId,
      hashPassword,
    });

    expect(result.created).toBe(true);
    expect(hashPassword).toHaveBeenCalledWith(
      "a-secure-bootstrap-password-2026",
    );
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        tenantId: existingAdmin.tenantId,
        email: existingAdmin.email,
        name: "Administrador",
        passwordHash: "new-secure-hash",
        role: "ADMIN",
      },
    });
  });
});
