import { describe, expect, it } from "vitest";
import {
  validarJornadaComInterjornada,
  validarJornadaManual,
} from "./validator";

describe("validarJornadaManual", () => {
  it("valida jornada simples de 4 horas", () => {
    const result = validarJornadaManual({ horarios: "08:00 12:00" });

    expect(result.valido).toBe(true);
    expect(result.duracaoCalculada).toBe("04:00");
    expect(result.horasSemanais).toBe(24);
    expect(result.horasMensais).toBe(120);
  });

  it("valida cargas mensais pela formula semanal/6*30", () => {
    expect(
      validarJornadaManual({ horarios: "08:00 11:00 12:00 15:00" }),
    ).toMatchObject({
      valido: true,
      duracaoCalculada: "06:00",
      horasSemanais: 36,
      horasMensais: 180,
    });
    expect(
      validarJornadaManual({ horarios: "08:00 10:30 11:30 14:00" }),
    ).toMatchObject({
      valido: true,
      duracaoCalculada: "05:00",
      horasSemanais: 30,
      horasMensais: 150,
    });
    expect(
      validarJornadaManual({ horarios: "08:00 10:10 11:10 13:20" }),
    ).toMatchObject({
      valido: true,
      duracaoCalculada: "04:20",
      horasSemanais: 26,
      horasMensais: 130,
    });
  });

  it("valida jornada de 8 horas com intervalo", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 13:00 17:00",
    });

    expect(result.valido).toBe(true);
    expect(result.duracaoCalculada).toBe("08:00");
    expect(result.horasSemanais).toBe(44);
    expect(result.intervalo).toBe("01:00");
  });

  it("rejeita formato inválido", () => {
    const result = validarJornadaManual({ horarios: "08:00 25:00" });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Formato inválido");
  });

  it("rejeita intervalo insuficiente", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 12:10 16:10",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Intervalo insuficiente");
  });

  it("rejeita periodos antes ou depois do almoco acima de 4 horas", () => {
    const result = validarJornadaManual({
      horarios: "07:00 11:30 12:30 16:30",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Primeiro periodo");
    expect(result.mensagem).toContain("excede 4h");
  });

  it("rejeita duração acima do limite diário", () => {
    const result = validarJornadaManual({
      horarios: "06:00 12:00 13:00 19:30",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("excede limite");
  });
});

describe("validarJornadaComInterjornada", () => {
  it("valida interjornada de 11 horas", () => {
    const result = validarJornadaComInterjornada({
      modo: "interjornada",
      horarios1: "08:00 12:00 13:00 17:00",
      horarios2: "04:00 08:00 09:00 13:00",
    });

    expect(result.valido).toBe(true);
    expect(result.interjornadaMinutos).toBe(660);
    expect(result.mensagemInterjornada).toContain("Interjornada");
  });

  it("rejeita interjornada menor que 11 horas", () => {
    const result = validarJornadaComInterjornada({
      modo: "interjornada",
      horarios1: "08:00 12:00 13:00 17:00",
      horarios2: "17:30 21:30",
    });

    expect(result.jornada1.valido).toBe(true);
    expect(result.jornada2.valido).toBe(true);
    expect(result.valido).toBe(false);
    expect(result.mensagemInterjornada).toContain("insuficiente");
  });

  it("valida sexta e sabado combinado 8h + 4h", () => {
    const result = validarJornadaComInterjornada({
      modo: "sabado-combinado",
      horarios1: "08:00 12:00 13:00 17:00",
      horarios2: "08:00 12:00",
    });

    expect(result.valido).toBe(true);
    expect(result.jornada1.duracaoCalculada).toBe("08:00");
    expect(result.jornada2.duracaoCalculada).toBe("04:00");
    expect(result.jornada2.horasSemanais).toBe(44);
    expect(result.jornada2.horasMensais).toBe(220);
    expect(result.mensagemInterjornada).toContain("semanais");
  });

  it("mantem sabado combinado valido quando a interjornada opcional esta desligada", () => {
    const result = validarJornadaComInterjornada({
      modo: "sabado-combinado",
      horarios1: "08:00 12:00 13:00 17:00",
      horarios2: "17:30 21:30",
      validarInterjornada: false,
    });

    expect(result.valido).toBe(true);
    expect(result.mensagemInterjornada).toContain("Interjornada nao avaliada");
    expect(result.jornada2.horasSemanais).toBe(44);
    expect(result.jornada2.horasMensais).toBe(220);
  });

  it("detalha duracao dos periodos em erro de intervalo excessivo", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 15:00 18:20",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Periodo total");
    expect(result.mensagem).toContain("Intervalo excessivo");
    expect(result.mensagem).toContain("Primeiro periodo: 4h");
    expect(result.mensagem).toContain("Segundo periodo: 3h20");
  });

  it("rejeita sabado combinado sem jornada principal de 8h", () => {
    const result = validarJornadaComInterjornada({
      modo: "sabado-combinado",
      horarios1: "08:00 12:00",
      horarios2: "08:00 12:00",
    });

    expect(result.jornada1.valido).toBe(true);
    expect(result.jornada2.valido).toBe(false);
    expect(result.jornada2.mensagem).toContain("deve ser 8h");
  });
});
