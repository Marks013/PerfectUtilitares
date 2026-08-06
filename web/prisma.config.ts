import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL?.trim();
const localFallbackAllowed =
  process.env.NODE_ENV === "test" ||
  process.env.PRISMA_ALLOW_LOCAL_FALLBACK === "true";

if (!databaseUrl && localFallbackAllowed) {
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5432/perfectutilitares?schema=public";
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL é obrigatória. Para geração local isolada, declare PRISMA_ALLOW_LOCAL_FALLBACK=true explicitamente.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
