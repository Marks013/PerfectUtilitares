import { describe, expect, it } from "vitest";
import { generateJornadaHistoryPdf } from "./pdf";

describe("generateJornadaHistoryPdf", () => {
  it("generates a PDF report for selected history records", async () => {
    const pdf = await generateJornadaHistoryPdf([
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
    ]);

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});
