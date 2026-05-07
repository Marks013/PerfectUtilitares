import type { PrismaClient } from "@prisma/client";
import type { CodigoImportParseResult } from "./importer";

export type CodigoImportPersistResult = CodigoImportParseResult & {
  importados: number;
};

export async function persistCodigoImport(
  prisma: PrismaClient,
  parsed: CodigoImportParseResult,
): Promise<CodigoImportPersistResult> {
  let importados = 0;

  for (const row of parsed.importaveis) {
    await prisma.codigoJornada.upsert({
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
    });
    importados += 1;
  }

  return {
    ...parsed,
    importados,
  };
}
