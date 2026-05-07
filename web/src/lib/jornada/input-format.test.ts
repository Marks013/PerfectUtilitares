import { describe, expect, it } from "vitest";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
  isJornadaOitoHoras,
} from "./input-format";

describe("formatarHorariosEntrada", () => {
  it("autoformata horarios compactos", () => {
    expect(formatarHorariosEntrada("0800 1200 1400 1620")).toBe(
      "08:00 12:00 14:00 16:20",
    );
  });

  it("detecta jornada de 8 horas para solicitar sabado", () => {
    expect(isJornadaOitoHoras("0800 1200 1400 1800")).toBe(true);
    expect(calcularDuracaoEntrada("0800 1200 1500 1820")).toMatchObject({
      duracaoFormatada: "07:20",
      duracaoMinutos: 440,
    });
  });
});
