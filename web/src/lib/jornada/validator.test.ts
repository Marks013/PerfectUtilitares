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

  it("rejeita jornada de 4 horas com intervalo", () => {
    const result = validarJornadaManual({
      horarios: "08:00 10:00 11:00 13:00",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("04:00 não deve ter intervalo");
    expect(result.mensagem).toContain("Informe apenas 2 horários");
  });

  it("rejeita jornada de 6 horas como segunda a sexta", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 14:00 16:00",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Total informado: 06:00");
  });

  it("valida jornada de 5h50 com intervalo de 15 minutos", () => {
    const result = validarJornadaManual({
      horarios: "08:00 11:00 11:15 14:05",
    });

    expect(result.valido).toBe(true);
    expect(result.duracaoCalculada).toBe("05:50");
    expect(result.intervalo).toBe("00:15");
  });

  it("rejeita jornada de 5h50 com intervalo diferente de 15 minutos", () => {
    const result = validarJornadaManual({
      horarios: "08:00 11:00 11:30 14:20",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Intervalo excessivo");
  });

  it("valida jornada de 7h20 com almoço de 1 hora", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 13:00 16:20",
    });

    expect(result.valido).toBe(true);
    expect(result.duracaoCalculada).toBe("07:20");
    expect(result.intervalo).toBe("01:00");
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
    expect(result.mensagem).toContain("Horário incompleto ou inválido: 25:00");
    expect(result.mensagem).toContain("Use o formato HH:MM");
  });

  it("detalha quando falta horario para fechar os pares", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 15:00",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Horários recebidos: 3");
    expect(result.mensagem).toContain("Primeiro período trabalhado: 4h");
  });

  it("detalha horario incompleto ou com digitos a mais", () => {
    const incompleto = validarJornadaManual({
      horarios: "08:00 12:00 15:00 16:0",
    });
    const excesso = validarJornadaManual({
      horarios: "08:000 12:00 15:00 18:00",
    });

    expect(incompleto.valido).toBe(false);
    expect(incompleto.mensagem).toContain("16:0");
    expect(excesso.valido).toBe(false);
    expect(excesso.mensagem).toContain("08:000");
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
    expect(result.mensagem).toContain("Primeiro período");
    expect(result.mensagem).toContain("excede 4h");
    expect(result.mensagem).toContain("no máximo 04:00");
  });

  it("aceita jornada fora da regra quando existe exceção autorizada", () => {
    const result = validarJornadaManual(
      {
        horarios: "08:00 11:30 13:30 18:00",
      },
      undefined,
      undefined,
      [
        {
          id: "exc_001",
          nome: "Acordo gerência",
          horariosNormalizado: "08:00 11:30 13:30 18:00",
          sabadoNormalizado: "08:00 12:00",
          active: true,
        },
      ],
    );

    expect(result.valido).toBe(true);
    expect(result.excecaoId).toBe("exc_001");
    expect(result.mensagem).toContain("exceção autorizada");
  });

  it("rejeita periodos e duracao trabalhada fora das jornadas aceitas", () => {
    const result = validarJornadaManual({
      horarios: "06:00 12:00 13:00 19:30",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Primeiro período (6h) excede 4h");
    expect(result.mensagem).toContain("Segundo período (6h30) excede 4h");
    expect(result.mensagem).toContain("Total informado: 12:30");
    expect(result.mensagem).not.toContain("Tempo total dentro da mesma jornada");
    expect(result.mensagem).not.toContain("interjornada");
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
    expect(result.mensagemInterjornada).toContain("Interjornada");
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

  it("valida sexta e sabado combinado quando a principal usa exceção autorizada", () => {
    const result = validarJornadaComInterjornada(
      {
        modo: "sabado-combinado",
        horarios1: "08:00 11:30 13:30 18:00",
        horarios2: "08:00 12:00",
        validarInterjornada: false,
      },
      undefined,
      undefined,
      [
        {
          id: "exc_002",
          nome: "Escala especial",
          horariosNormalizado: "08:00 11:30 13:30 18:00",
          sabadoNormalizado: "08:00 12:00",
          active: true,
        },
      ],
    );

    expect(result.valido).toBe(true);
    expect(result.jornada1.excecaoId).toBe("exc_002");
    expect(result.jornada1.duracaoCalculada).toBe("08:00");
    expect(result.jornada2.duracaoCalculada).toBe("04:00");
  });

  it("mantem sabado combinado valido quando a interjornada opcional esta desligada", () => {
    const result = validarJornadaComInterjornada({
      modo: "sabado-combinado",
      horarios1: "08:00 12:00 13:00 17:00",
      horarios2: "17:30 21:30",
      validarInterjornada: false,
    });

    expect(result.valido).toBe(true);
    expect(result.mensagemInterjornada).toContain("Interjornada não avaliada");
    expect(result.jornada2.horasSemanais).toBe(44);
    expect(result.jornada2.horasMensais).toBe(220);
  });

  it("detalha duracao dos periodos em erro de intervalo excessivo", () => {
    const result = validarJornadaManual({
      horarios: "08:00 12:00 15:00 18:20",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).not.toContain("Tempo total dentro da mesma jornada");
    expect(result.mensagem).not.toContain("interjornada");
    expect(result.mensagem).toContain("Intervalo excessivo");
    expect(result.mensagem).toContain("Primeiro período trabalhado: 4h");
    expect(result.mensagem).toContain("Segundo período trabalhado: 3h20");
  });

  it("nao mistura limite de interjornada na validacao de uma unica jornada", () => {
    const result = validarJornadaManual({
      horarios: "10:40 14:00 16:00 21:00",
    });

    expect(result.valido).toBe(false);
    expect(result.mensagem).toContain("Segundo período (5h) excede 4h");
    expect(result.mensagem).toContain("Total informado: 08:20");
    expect(result.mensagem).not.toContain("Tempo total dentro da mesma jornada");
    expect(result.mensagem).not.toContain("interjornada");
    expect(result.mensagem).not.toContain("10h20");
  });

  it("rejeita sabado combinado sem jornada principal de 8h", () => {
    const result = validarJornadaComInterjornada({
      modo: "sabado-combinado",
      horarios1: "08:00 12:00",
      horarios2: "08:00 12:00",
    });

    expect(result.jornada1.valido).toBe(true);
    expect(result.jornada2.valido).toBe(false);
    expect(result.jornada2.mensagem).toContain("jornada válida de 08:00");
  });
});
