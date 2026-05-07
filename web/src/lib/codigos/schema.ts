import { z } from "zod";
import {
  normalizarHorarios,
  validarHorariosNormalizados,
} from "@/lib/codigos/horario-normalizer";

export const codigoJornadaSchema = z
  .object({
    codigo: z.string().trim().min(1).max(50),
    horariosOriginal: z.string().trim().min(1).max(80),
  })
  .transform((value, context) => {
    const horariosNormalizado = normalizarHorarios(value.horariosOriginal);
    const validacao = validarHorariosNormalizados(horariosNormalizado);

    if (!validacao.valido) {
      context.addIssue({
        code: "custom",
        path: ["horariosOriginal"],
        message: validacao.mensagem,
      });
      return z.NEVER;
    }

    return {
      codigo: value.codigo,
      horariosOriginal: value.horariosOriginal,
      horariosNormalizado,
    };
  });

export const codigoJornadaPatchSchema = codigoJornadaSchema;

export type CodigoJornadaFormInput = z.input<typeof codigoJornadaSchema>;
export type CodigoJornadaFormValues = z.output<typeof codigoJornadaSchema>;

export function zodIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
