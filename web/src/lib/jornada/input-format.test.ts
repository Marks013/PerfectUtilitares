import { describe, expect, it } from "vitest";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
  isJornadaOitoHoras,
  temTrabalhoNoturno,
} from "./input-format";

describe("formatarHorariosEntrada", () => {
  it("autoformata horarios compactos", () => {
    expect(formatarHorariosEntrada("0800 1200 1400 1620")).toBe(
      "08:00 12:00 14:00 16:20",
    );
  });

  it("autoformata horarios compactos mesmo quando o valor final e invalido", () => {
    expect(formatarHorariosEntrada("0800 1200 1500 2500")).toBe(
      "08:00 12:00 15:00 25:00",
    );
  });

  it("detecta jornada de 8 horas para solicitar sabado", () => {
    expect(isJornadaOitoHoras("0800 1200 1400 1800")).toBe(true);
    expect(calcularDuracaoEntrada("0800 1200 1500 1820")).toMatchObject({
      duracaoFormatada: "07:20",
      duracaoMinutos: 440,
    });
  });

  it("detecta trabalho que cruza o periodo noturno", () => {
    expect(temTrabalhoNoturno("21:30 22:30")).toBe(true);
    expect(temTrabalhoNoturno("04:00 06:00")).toBe(true);
    expect(temTrabalhoNoturno("0800 1200 2200 2300")).toBe(true);
    expect(temTrabalhoNoturno("22:00 05:00")).toBe(true);
  });

  it("nao considera jornadas diurnas nem os limites externos", () => {
    expect(temTrabalhoNoturno("08:00 12:00 13:00 17:00")).toBe(false);
    expect(temTrabalhoNoturno("05:00 12:00 13:00 22:00")).toBe(false);
    expect(temTrabalhoNoturno("")).toBe(false);
    expect(temTrabalhoNoturno("horario invalido")).toBe(false);
  });
});
