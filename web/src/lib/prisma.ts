import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaAdapter } from "@/lib/prisma-adapter";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaEnvironment() {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    (process.env.NODE_ENV === "test"
      ? "postgresql://test:test@127.0.0.1:5432/perfectutilitares_test?schema=public"
      : undefined);

  return {
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DATABASE_CONNECTION_TIMEOUT_MS:
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
    DATABASE_IDLE_TIMEOUT_MS: process.env.DATABASE_IDLE_TIMEOUT_MS,
  };
}

function createPrismaClient() {
  return new PrismaClient({ adapter: createPrismaAdapter(createPrismaEnvironment()) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
