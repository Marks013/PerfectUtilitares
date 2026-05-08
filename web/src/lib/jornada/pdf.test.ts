import { describe, expect, it } from "vitest";
import { generateJornadaHistoryPdf } from "./pdf";

describe("generateJornadaHistoryPdf", () => {
  it("generates a PDF report for selected history records", async () => {
    const pdf = await generateJornadaHistoryPdf([
      {
        nome: "Pessoa Teste",
        matricula: "",
        dataAlteracao: "2026-05-07",
        records: [
          {
            id: "cm123",
            createdAt: new Date("2026-05-07T12:00:00Z"),
            horariosOriginal: "08:00 12:00 13:00 17:00",
            horariosNormalizado: "08:00 12:00 13:00 17:00",
            valido: true,
            mensagem: "Jornada válida: Jornada de 08:00",
            duracaoCalculada: "08:00",
            tipoDia: "util",
            codigo: "123",
            horasSemanais: 44,
            horasMensais: 220,
            intervalo: "1h",
            user: { name: "Operador", email: "operador@example.com" },
          },
        ],
      },
    ]);

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(500);
  });

  it("groups people with the same schedule and change date", async () => {
    const records = [
      {
        id: "cm123",
        createdAt: new Date("2026-05-07T12:00:00Z"),
        horariosOriginal: "08:00 12:00 13:00 17:00",
        horariosNormalizado: "08:00 12:00 13:00 17:00",
        valido: true,
        mensagem: "Jornada válida: Jornada de 08:00",
        duracaoCalculada: "08:00",
        tipoDia: "util",
        codigo: "U123",
        horasSemanais: 44,
        horasMensais: 220,
        intervalo: "1h",
        user: { name: "Operador", email: "operador@example.com" },
      },
      {
        id: "cm456",
        createdAt: new Date("2026-05-07T12:00:01Z"),
        horariosOriginal: "08:00 12:00",
        horariosNormalizado: "08:00 12:00",
        valido: true,
        mensagem: "Jornada Sábado - 4h",
        duracaoCalculada: "04:00",
        tipoDia: "sabado",
        codigo: "S456",
        horasSemanais: 4,
        horasMensais: 20,
        intervalo: null,
        user: { name: "Operador", email: "operador@example.com" },
      },
    ];

    const pdf = await generateJornadaHistoryPdf([
      {
        nome: "Pessoa Um",
        matricula: "",
        dataAlteracao: "2026-05-08",
        records,
      },
      {
        nome: "Pessoa Dois",
        matricula: "200",
        dataAlteracao: "2026-05-08",
        records,
      },
    ]);

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});
