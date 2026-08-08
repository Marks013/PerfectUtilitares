import { hash } from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

const BOOTSTRAP_ADMIN_PASSWORD_MIN_LENGTH = 20;

const rejectedBootstrapPasswords = new Set([
  "admin123",
  "administrador",
  "password",
  "perfectutilitares",
]);

export function validateBootstrapAdminPassword(value: string | undefined) {
  if (!value) {
    throw new Error(
      "ADMIN_PASSWORD é obrigatório somente para criar o administrador inicial.",
    );
  }

  if (
    value.length < BOOTSTRAP_ADMIN_PASSWORD_MIN_LENGTH ||
    value.length > BCRYPT_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `ADMIN_PASSWORD deve ter entre ${BOOTSTRAP_ADMIN_PASSWORD_MIN_LENGTH} e ${BCRYPT_PASSWORD_MAX_LENGTH} caracteres.`,
    );
  }

  if (rejectedBootstrapPasswords.has(value.trim().toLowerCase())) {
    throw new Error("ADMIN_PASSWORD usa um valor previsível e foi rejeitado.");
  }

  return value;
}

type AdminSeedPrisma = Pick<PrismaClient, "user">;

type EnsureBootstrapAdminInput = {
  email: string;
  password?: string;
  tenantId: string;
  hashPassword?: (password: string) => Promise<string>;
};

export async function ensureBootstrapAdmin(
  prisma: AdminSeedPrisma,
  input: EnsureBootstrapAdminInput,
) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    return { created: false as const, user: existing };
  }

  const password = validateBootstrapAdminPassword(input.password);
  const hashPassword =
    input.hashPassword ?? ((plainText: string) => hash(plainText, 12));
  const user = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      email: input.email,
      name: "Administrador",
      passwordHash: await hashPassword(password),
      role: "ADMIN",
    },
  });

  return { created: true as const, user };
}
