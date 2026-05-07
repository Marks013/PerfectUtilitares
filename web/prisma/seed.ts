import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { DEFAULT_JORNADA_RULES } from "../src/lib/jornada/default-rules";

const prisma = new PrismaClient();

async function main() {
  const adminEmail =
    (
      process.env.ADMIN_EMAIL ??
      process.env.SEED_ADMIN_EMAIL ??
      "admin@local.test"
    )
      .trim()
      .toLowerCase();
  const adminPassword =
    process.env.ADMIN_PASSWORD ??
    process.env.SEED_ADMIN_PASSWORD ??
    "admin123";
  const tenant = await prisma.tenant.upsert({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "principal" },
    create: {
      name: process.env.DEFAULT_TENANT_NAME ?? "Principal",
      slug: process.env.DEFAULT_TENANT_SLUG ?? "principal",
    },
    update: {
      name: process.env.DEFAULT_TENANT_NAME ?? "Principal",
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      name: "Administrador",
      passwordHash: await hash(adminPassword, 12),
      role: "ADMIN",
      canAccessJornada: true,
      canAccessFotos: true,
    },
    update: {
      name: "Administrador",
      tenantId: tenant.id,
      passwordHash: await hash(adminPassword, 12),
      role: "ADMIN",
      isActive: true,
      canAccessJornada: true,
      canAccessFotos: true,
    },
  });

  for (const { id: _id, ...rule } of DEFAULT_JORNADA_RULES) {
    await prisma.jornadaRule.upsert({
      where: { nome: rule.nome },
      create: rule,
      update: { ...rule, active: true },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
