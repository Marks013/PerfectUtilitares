import { describe, expect, it } from "vitest";
import { generateJornadaBatchReportPdf } from "./batch-pdf";
import type { JornadaBatchReport } from "./batch-validation";

describe("generateJornadaBatchReportPdf", () => {
  it("gera relatório PDF da validação em lote", async () => {
    const report: JornadaBatchReport = {
      arquivoOrigem: "FPRE110.xlsx",
      nomePlanilha: "Planilha1",
      totalLinhas: 2,
      validos: 1,
      erros: 1,
      avisos: 0,
      jornadasRepetidas: {
        "13:35 - 17:00 - 18:15 - 22:10": 1,
        "08:00 - 12:00 - 13:00 - 17:00": 1,
      },
      linhas: [],
      linhasComErro: [
        {
          numeroLinha: 10,
          matricula: "123",
          nome: "COLABORADOR TESTE",
          cargo: "OPERADOR",
          horarios: ["13:35", "17:00", "18:15", "22:10"],
          horariosOriginais: "13:35 17:00 18:15 22:10",
          jornadaCompleta: "13:35 - 17:00 - 18:15 - 22:10",
          resultado: {
            valido: false,
            mensagem: "Jornada nao encontrada",
            duracaoCalculada: "07:20",
            tipoDia: "util",
            horasSemanais: 0,
            horasMensais: 0,
          },
        },
      ],
    };

    const pdf = await generateJornadaBatchReportPdf(report);

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});
