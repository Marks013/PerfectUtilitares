import "dotenv/config";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";
import { validateBootstrapAdminPassword } from "../src/lib/system/seed-admin";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

async function persistAdminPassword(value: string) {
  const target = path.resolve(process.env.ADMIN_ENV_FILE ?? ".env");
  const metadata = await stat(target);
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error("Arquivo de ambiente precisa possuir permissão 0600.");
  }

  const source = await readFile(target, "utf8");
  const line = `ADMIN_PASSWORD=${value}`;
  const updated = /^ADMIN_PASSWORD=.*$/m.test(source)
    ? source.replace(/^ADMIN_PASSWORD=.*$/m, line)
    : `${source.trimEnd()}\n${line}\n`;
  const temporary = `${target}.tmp-${randomUUID()}`;

  try {
    await writeFile(temporary, updated, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = validateBootstrapAdminPassword(
    process.env.ROTATE_ADMIN_PASSWORD,
  );

  if (!email) {
    throw new Error("ADMIN_EMAIL é obrigatório para rotação.");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user || user.role !== "ADMIN") {
    throw new Error("Administrador alvo não foi encontrado.");
  }

  const passwordHash = await hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  await persistAdminPassword(password);
  console.log("Senha administrativa rotacionada e ambiente protegido atualizado.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
