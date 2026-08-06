import { describe, expect, it } from "vitest";
import { createPrismaPgConfig } from "@/lib/prisma-adapter";

describe("createPrismaPgConfig", () => {
  it("mantém limites equivalentes ao comportamento anterior por padrão", () => {
    expect(
      createPrismaPgConfig({
        DATABASE_URL:
          "postgresql://postgres:secret@db:5432/app?schema=unimed&sslmode=require",
      }),
    ).toEqual({
      pool: {
        connectionString:
          "postgresql://postgres:secret@db:5432/app?sslmode=require",
        max: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 300_000,
      },
      schema: "unimed",
    });
  });

  it("aceita ajustes explícitos do pool", () => {
    expect(
      createPrismaPgConfig({
        DATABASE_URL: "postgresql://postgres:secret@db:5432/app",
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECTION_TIMEOUT_MS: "2500",
        DATABASE_IDLE_TIMEOUT_MS: "60000",
      }),
    ).toMatchObject({
      pool: {
        max: 4,
        connectionTimeoutMillis: 2_500,
        idleTimeoutMillis: 60_000,
      },
      schema: "public",
    });
  });

  it("recusa configuração ausente ou inválida", () => {
    expect(() => createPrismaPgConfig({})).toThrow("DATABASE_URL");
    expect(() =>
      createPrismaPgConfig({
        DATABASE_URL: "postgresql://db/app",
        DATABASE_POOL_MAX: "0",
      }),
    ).toThrow("DATABASE_POOL_MAX");
    expect(() =>
      createPrismaPgConfig({ DATABASE_URL: "mysql://db/app" }),
    ).toThrow("postgresql://");
  });
});
