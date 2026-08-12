import { describe, expect, it } from "vitest";
import {
  jornadaRulePatchSchema,
  jornadaRuleSchema,
} from "@/lib/jornada/rule-schema";

describe("jornada rule schema", () => {
  it("coerces numeric form fields and preserves false status", () => {
    const parsed = jornadaRuleSchema.parse({
      nome: " Jornada teste ",
      duracaoMinutos: "480",
      horasSemanais: "44",
      horasMensais: "220",
      intervaloMin: "60",
      intervaloMax: "120",
      limitePeriodoMinutos: "300",
      diasValidos: ["util", "util", "sabado"],
      active: "false",
    });

    expect(parsed).toMatchObject({
      nome: "Jornada teste",
      duracaoMinutos: 480,
      limitePeriodoMinutos: 300,
      active: false,
      diasValidos: ["util", "sabado"],
    });
  });

  it("preserves the 4-hour period limit for compatible API clients", () => {
    const parsed = jornadaRuleSchema.parse({
      nome: "Jornada compatível",
      duracaoMinutos: 480,
      horasSemanais: 44,
      horasMensais: 220,
      intervaloMin: 60,
      intervaloMax: 120,
      diasValidos: ["util"],
      active: true,
    });

    expect(parsed.limitePeriodoMinutos).toBe(240);
  });

  it("does not reset a customized period limit in partial updates", () => {
    const parsed = jornadaRulePatchSchema.parse({ nome: "Nome atualizado" });

    expect(parsed).not.toHaveProperty("limitePeriodoMinutos");
  });

  it("rejects interval max lower than interval min", () => {
    const parsed = jornadaRuleSchema.safeParse({
      nome: "Jornada invalida",
      duracaoMinutos: 480,
      horasSemanais: 44,
      horasMensais: 220,
      intervaloMin: 120,
      intervaloMax: 60,
      diasValidos: ["util"],
      active: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects monthly hours outside weekly divided by 6 times 30", () => {
    const parsed = jornadaRuleSchema.safeParse({
      nome: "Jornada mensal invalida",
      duracaoMinutos: 360,
      horasSemanais: 36,
      horasMensais: 175,
      intervaloMin: 60,
      intervaloMax: 120,
      diasValidos: ["util"],
      active: true,
    });

    expect(parsed.success).toBe(false);
  });
});
