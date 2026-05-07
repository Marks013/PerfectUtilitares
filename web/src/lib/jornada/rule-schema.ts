import { z } from "zod";

export const diaValidoSchema = z.enum(["util", "sabado", "domingo", "feriado"]);

const booleanishSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const jornadaRuleObjectSchema = z.object({
  nome: z.string().trim().min(3).max(100),
  duracaoMinutos: z.coerce.number().int().min(1).max(720),
  horasSemanais: z.coerce.number().int().min(1).max(168),
  horasMensais: z.coerce.number().int().min(1).max(744),
  intervaloMin: z.coerce.number().int().min(0).max(720),
  intervaloMax: z.coerce.number().int().min(0).max(720),
  diasValidos: z.array(diaValidoSchema).min(1),
  active: booleanishSchema.default(true),
});

function calcularHorasMensais(horasSemanais: number) {
  return horasSemanais * 5;
}

const jornadaRuleBaseSchema = jornadaRuleObjectSchema.superRefine(
  (value, context) => {
    if (value.intervaloMax < value.intervaloMin) {
      context.addIssue({
        code: "custom",
        path: ["intervaloMax"],
        message: "Intervalo máximo deve ser maior ou igual ao mínimo",
      });
    }

    const horasMensaisCalculadas = calcularHorasMensais(value.horasSemanais);
    if (value.horasMensais !== horasMensaisCalculadas) {
      context.addIssue({
        code: "custom",
        path: ["horasMensais"],
        message:
          "Horas mensais devem seguir a formula: horas semanais / 6 x 30",
      });
    }
  },
);

export const jornadaRuleSchema = jornadaRuleBaseSchema.transform((value) => ({
    ...value,
    diasValidos: [...new Set(value.diasValidos)],
  }));

export const jornadaRulePatchSchema = jornadaRuleObjectSchema.partial().superRefine(
  (value, context) => {
    if (
      value.intervaloMin !== undefined &&
      value.intervaloMax !== undefined &&
      value.intervaloMax < value.intervaloMin
    ) {
      context.addIssue({
        code: "custom",
        path: ["intervaloMax"],
        message: "Intervalo máximo deve ser maior ou igual ao mínimo",
      });
    }

    if (
      value.horasSemanais !== undefined &&
      value.horasMensais !== undefined &&
      value.horasMensais !== calcularHorasMensais(value.horasSemanais)
    ) {
      context.addIssue({
        code: "custom",
        path: ["horasMensais"],
        message:
          "Horas mensais devem seguir a formula: horas semanais / 6 x 30",
      });
    }
  },
);

export type JornadaRuleFormInput = z.input<typeof jornadaRuleSchema>;
export type JornadaRuleFormValues = z.output<typeof jornadaRuleSchema>;

export function zodIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
