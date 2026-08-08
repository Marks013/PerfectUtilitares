import type { PrismaClient } from "@/generated/prisma/client";
import type { CodigoImportParseResult } from "./importer";

export type CodigoImportPersistResult = CodigoImportParseResult & {
  importados: number;
};

const IMPORT_BATCH_SIZE = 50;

export async function persistCodigoImport(
  prisma: PrismaClient,
  parsed: CodigoImportParseResult,
): Promise<CodigoImportPersistResult> {
  return prisma.$transaction(
    async (transaction) => {
      let importados = 0;

      for (
        let offset = 0;
        offset < parsed.importaveis.length;
        offset += IMPORT_BATCH_SIZE
      ) {
        const batch = parsed.importaveis.slice(
          offset,
          offset + IMPORT_BATCH_SIZE,
        );
        await Promise.all(
          batch.map((row) =>
            transaction.codigoJornada.upsert({
              where: {
                horariosNormalizado: row.horariosNormalizado,
              },
              create: {
                codigo: row.codigo,
                horariosOriginal: row.horariosOriginal,
                horariosNormalizado: row.horariosNormalizado,
                origem: row.origem,
                linha: row.linha,
              },
              update: {
                codigo: row.codigo,
                horariosOriginal: row.horariosOriginal,
                origem: row.origem,
                linha: row.linha,
              },
            }),
          ),
        );
        importados += batch.length;
      }

      return {
        ...parsed,
        importados,
      };
    },
    {
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}
