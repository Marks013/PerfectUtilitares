import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CodigoImportParseResult } from "./importer";
import { persistCodigoImport } from "./repository";

function parsedRows(count: number): CodigoImportParseResult {
  return {
    totalLido: count,
    importaveis: Array.from({ length: count }, (_, index) => ({
      codigo: `COD-${index}`,
      horariosOriginal: "08:00 12:00 13:00 17:00",
      horariosNormalizado: `08:00 12:00 13:00 17:${String(index).padStart(2, "0")}`,
      origem: "CSV",
      linha: index + 1,
    })),
    ignorados: 0,
    erros: [],
  };
}

describe("persistCodigoImport", () => {
  it("persists all rows atomically in bounded batches", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const transactionClient = { codigoJornada: { upsert } };
    const transaction = vi.fn(async (callback, options) => {
      expect(options).toEqual({ maxWait: 10_000, timeout: 120_000 });
      return callback(transactionClient);
    });
    const parsed = parsedRows(51);

    const result = await persistCodigoImport(
      { $transaction: transaction } as unknown as PrismaClient,
      parsed,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(51);
    expect(result.importados).toBe(51);
    expect(result.totalLido).toBe(51);
  });

  it("does not report a partial import when the transaction fails", async () => {
    const transaction = vi.fn().mockRejectedValue(new Error("rollback"));
    const parsed = parsedRows(2);

    await expect(
      persistCodigoImport(
        { $transaction: transaction } as unknown as PrismaClient,
        parsed,
      ),
    ).rejects.toThrow("rollback");
  });

  it("returns zero without issuing writes for an empty import", async () => {
    const upsert = vi.fn();
    const transactionClient = { codigoJornada: { upsert } };
    const transaction = vi.fn(async (callback) =>
      callback(transactionClient),
    );

    const result = await persistCodigoImport(
      { $transaction: transaction } as unknown as PrismaClient,
      parsedRows(0),
    );

    expect(upsert).not.toHaveBeenCalled();
    expect(result.importados).toBe(0);
  });
});
