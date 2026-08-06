import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

try {
  const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  if (result[0]?.ok !== 1) {
    throw new Error(`Resposta inesperada do PostgreSQL: ${JSON.stringify(result)}`);
  }
  console.log("OK: Prisma 7 conectou ao PostgreSQL e executou SELECT 1.");
} finally {
  await prisma.$disconnect();
}
