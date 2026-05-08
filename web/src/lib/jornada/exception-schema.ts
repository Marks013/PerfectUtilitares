import { z } from "zod";
import {
  normalizarHorarios,
  validarHorariosNormalizados,
} from "@/lib/codigos/horario-normalizer";
import { formatarHorariosEntrada } from "@/lib/jornada/input-format";

function normalizeSchedule(value: string) {
  return normalizarHorarios(formatarHorariosEntrada(value));
}

function validSchedule(value: string, maxItems: 2 | 4 = 4) {
  const normalized = normalizeSchedule(value);
  const validation = validarHorariosNormalizados(normalized);
  const size = normalized ? normalized.split(" ").length : 0;

  return {
    normalized,
    valid:
      validation.valido &&
      (maxItems === 4 ? size === 2 || size === 4 : size === 2),
    message:
      maxItems === 2
        ? "Informe exatamente 2 horários válidos para sábado"
        : "Informe 2 ou 4 horários válidos",
  };
}

export const jornadaExceptionSchema = z
  .object({
    userId: z.string().min(8).max(64),
    nome: z.string().trim().max(100).optional().default(""),
    horarios: z.string().trim().min(1).max(80),
    sabadoHorarios: z.string().trim().max(80).optional().default(""),
    active: z.boolean().default(true),
  })
  .transform((value) => ({
    ...value,
    nome: value.nome.trim() || null,
    horariosNormalizado: normalizeSchedule(value.horarios),
    sabadoNormalizado: value.sabadoHorarios
      ? normalizeSchedule(value.sabadoHorarios)
      : null,
  }))
  .superRefine((value, context) => {
    const principal = validSchedule(value.horarios);
    if (!principal.valid) {
      context.addIssue({
        code: "custom",
        path: ["horarios"],
        message: principal.message,
      });
    }

    if (value.sabadoHorarios) {
      const sabado = validSchedule(value.sabadoHorarios, 2);
      if (!sabado.valid) {
        context.addIssue({
          code: "custom",
          path: ["sabadoHorarios"],
          message: sabado.message,
        });
      }
    }
  });

export const jornadaExceptionPatchSchema = z.object({
  active: z.boolean(),
});

export type JornadaExceptionFormInput = z.input<typeof jornadaExceptionSchema>;
export type JornadaExceptionFormValues = z.output<typeof jornadaExceptionSchema>;

export function zodIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

