import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCodigoCsvBuffer,
  parseCodigoJson,
  parseCodigoXlsxBuffer,
} from "./importer";
import { normalizarHorarios } from "./horario-normalizer";

describe("normalizarHorarios", () => {
  it("replica o comportamento do HorarioNormalizer legado", () => {
    expect(normalizarHorarios(" 06:00\t10:00  12:00 15:20 ")).toBe(
      "06:00 10:00 12:00 15:20",
    );
  });
});

describe("codigo import parser", () => {
  it("lê o arquivo de exemplo do banco de horários e ignora cabeçalho/linhas vazias", async () => {
    const file = resolve("src/lib/codigos/__fixtures__/banco-horario.xlsx");
    const result = await parseCodigoXlsxBuffer(readFileSync(file));

    expect(result.erros).toEqual([]);
    expect(result.importaveis.length).toBeGreaterThan(250);
    expect(result.importaveis[0]).toMatchObject({
      codigo: "1038",
      horariosOriginal: "06:00 10:00 12:00 15:20",
      horariosNormalizado: "06:00 10:00 12:00 15:20",
      origem: "XLSX",
      linha: 3,
    });
  });

  it("importa CSV com separador variavel", () => {
    const result = parseCodigoCsvBuffer(
      Buffer.from("Horario;Descricao\n1038;06:00 10:00 12:00 15:20\n"),
    );

    expect(result.importaveis).toHaveLength(1);
    expect(result.importaveis[0]?.codigo).toBe("1038");
  });

  it("importa JSON canonico e legado", () => {
    const canonical = parseCodigoJson([
      { codigo: "1038", horariosOriginal: "06:00 10:00 12:00 15:20" },
    ]);
    const legacy = parseCodigoJson({
      "06:00 10:00 12:00 15:20": "1038",
    });

    expect(canonical.importaveis[0]?.horariosNormalizado).toBe(
      legacy.importaveis[0]?.horariosNormalizado,
    );
  });

  it("rejeita linhas com quantidade inválida de horários", () => {
    const result = parseCodigoJson([{ codigo: "X", horariosOriginal: "08:00" }]);

    expect(result.importaveis).toHaveLength(0);
    expect(result.erros[0]?.mensagem).toContain("2 ou 4 horários");
  });
});
