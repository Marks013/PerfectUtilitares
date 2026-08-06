import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

type PrismaPgRuntimeConfig = {
  pool: PoolConfig;
  schema: string;
};

type PrismaPgEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "DATABASE_URL"
    | "DATABASE_POOL_MAX"
    | "DATABASE_CONNECTION_TIMEOUT_MS"
    | "DATABASE_IDLE_TIMEOUT_MS"
  >
>;

function parseInteger(
  rawValue: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
) {
  if (!rawValue?.trim()) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} deve ser um inteiro maior ou igual a ${minimum}.`);
  }

  return value;
}

function parseDatabaseUrl(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL não contém uma URL PostgreSQL válida.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL deve usar o protocolo postgresql:// ou postgres://.");
  }

  const schema = url.searchParams.get("schema")?.trim() || "public";
  url.searchParams.delete("schema");

  return {
    connectionString: url.toString(),
    schema,
  };
}

export function createPrismaPgConfig(
  env: PrismaPgEnvironment = process.env as unknown as PrismaPgEnvironment,
): PrismaPgRuntimeConfig {
  const rawConnectionString = env.DATABASE_URL?.trim();
  if (!rawConnectionString) {
    throw new Error("DATABASE_URL não está configurada para o Prisma.");
  }

  const { connectionString, schema } = parseDatabaseUrl(rawConnectionString);

  return {
    pool: {
      connectionString,
      max: parseInteger(
        env.DATABASE_POOL_MAX,
        DEFAULT_POOL_MAX,
        "DATABASE_POOL_MAX",
        1,
      ),
      connectionTimeoutMillis: parseInteger(
        env.DATABASE_CONNECTION_TIMEOUT_MS,
        DEFAULT_CONNECTION_TIMEOUT_MS,
        "DATABASE_CONNECTION_TIMEOUT_MS",
        0,
      ),
      idleTimeoutMillis: parseInteger(
        env.DATABASE_IDLE_TIMEOUT_MS,
        DEFAULT_IDLE_TIMEOUT_MS,
        "DATABASE_IDLE_TIMEOUT_MS",
        0,
      ),
    },
    schema,
  };
}

export function createPrismaAdapter(
  env: PrismaPgEnvironment = process.env as unknown as PrismaPgEnvironment,
) {
  const { pool, schema } = createPrismaPgConfig(env);
  return new PrismaPg(pool, { schema });
}
