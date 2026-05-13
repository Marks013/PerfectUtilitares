import { describe, expect, it } from "vitest";
import {
  formatBatchLineLabel,
  generateJornadaBatchReportPdf,
  getBatchDetailedScheduleGroups,
} from "./batch-pdf";
import type { JornadaBatchReport } from "./batch-validation";

describe("generateJornadaBatchReportPdf", () => {
  it("mostra matricula junto do nome na identificacao da linha", () => {
    expect(
      formatBatchLineLabel({
        matricula: "7707",
        nome: "ROGERIO SANTOS DE MENESES",
      }),
    ).toBe("7707 - ROGERIO SANTOS DE MENESES");
  });

  it("agrupa o PDF detalhado pelo horario principal e anexa o sabado ao colaborador", () => {
    const report: JornadaBatchReport = {
      arquivoOrigem: "FPRE110.xlsx",
      nomePlanilha: "Planilha1",
      totalLinhas: 2,
      validos: 2,
      erros: 0,
      avisos: 0,
      jornadasRepetidas: {
        "08:00 - 12:00 - 14:00 - 18:00": 1,
        "08:00 - 12:00": 1,
      },
      linhasComErro: [],
      linhas: [
        {
          numeroLinha: 3,
          matricula: "100",
          nome: "ANA TESTE",
          cargo: "CAIXA",
          horarios: ["08:00", "12:00", "14:00", "18:00"],
          horariosOriginais: "08:00 12:00 14:00 18:00",
          jornadaCompleta: "08:00 - 12:00 - 14:00 - 18:00",
        },
        {
          numeroLinha: 4,
          matricula: "100",
          nome: "ANA TESTE",
          cargo: "CAIXA",
          horarios: ["08:00", "12:00"],
          horariosOriginais: "08:00 12:00",
          jornadaCompleta: "08:00 - 12:00",
          linhaSabado: true,
        },
      ],
    };

    expect(getBatchDetailedScheduleGroups(report)).toEqual([
      {
        horarioPrincipal: "08:00 - 12:00 - 14:00 - 18:00",
        colaboradores: [
          {
            identificacao: "100 - ANA TESTE",
            nome: "ANA TESTE",
            matricula: "100",
            horarioPrincipal: "08:00 - 12:00 - 14:00 - 18:00",
            horarioSabado: "08:00 - 12:00",
          },
        ],
      },
    ]);
  });

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
