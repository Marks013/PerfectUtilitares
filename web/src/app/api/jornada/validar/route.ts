import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireModuleAccess,
  requireSameOrigin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";
import {
  validarJornadaComInterjornada,
  validarJornadaManual,
} from "@/lib/jornada/validator";
import type {
  JornadaExceptionInput,
  JornadaRuleInput,
  JornadaValidationResult,
} from "@/lib/jornada/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  modo: z
    .enum(["simples", "interjornada", "sabado-combinado"])
    .default("simples"),
  horarios: z.string().min(1),
  horarios2: z.string().optional(),
  tipoDia: z.enum(["util", "sabado", "domingo", "feriado"]).default("util"),
  validarInterjornada: z.boolean().default(true),
});

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const guard = await requireModuleAccess("jornada");
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-validar",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = requestSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      parsed.error.issues,
    );
  }

  const userId = guard.session.user.id;
  const [rules, codigos, exceptions] = await Promise.all([
    prisma.jornadaRule.findMany({ where: { active: true } }),
    prisma.codigoJornada.findMany(),
    prisma.jornadaException.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        nome: true,
        horariosNormalizado: true,
        sabadoNormalizado: true,
        active: true,
      },
    }),
  ]);

  const codigoByHorario = new Map(
    codigos.map((codigo) => [codigo.horariosNormalizado, codigo.codigo]),
  );
  const buscarCodigo = (horariosNormalizado: string) =>
    codigoByHorario.get(horariosNormalizado);
  const authorizedExceptions = exceptions as JornadaExceptionInput[];

  async function saveValidation(
    result: JornadaValidationResult,
    horariosOriginal: string,
  ) {
    return prisma.jornadaValidation.create({
      data: {
        userId,
        horariosOriginal,
        horariosNormalizado: result.horariosNormalizado,
        valido: result.valido,
        mensagem: result.mensagem,
        duracaoCalculada: result.duracaoCalculada,
        tipoDia: result.tipoDia,
        codigo: result.codigo,
        horasSemanais: result.horasSemanais,
        horasMensais: result.horasMensais,
        intervalo: result.intervalo,
      },
    });
  }

  if (parsed.data.modo !== "simples") {
    if (!parsed.data.horarios2) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "Informe a segunda jornada",
      );
    }

    const result = validarJornadaComInterjornada(
      {
        horarios1: parsed.data.horarios,
        horarios2: parsed.data.horarios2,
        modo: parsed.data.modo,
        validarInterjornada: parsed.data.validarInterjornada,
      },
      rules as JornadaRuleInput[],
      buscarCodigo,
      authorizedExceptions,
    );

    const [saved1, saved2] = await Promise.all([
      saveValidation(result.jornada1, parsed.data.horarios),
      saveValidation(result.jornada2, parsed.data.horarios2),
    ]);

    return NextResponse.json({
      ...result,
      ids: [saved1.id, saved2.id],
    });
  }

  const result = validarJornadaManual(
    {
      horarios: parsed.data.horarios,
      tipoDia: "util",
      exigirSabadoComplementar: true,
    },
    rules as JornadaRuleInput[],
    buscarCodigo,
    authorizedExceptions,
  );

  const saved = await saveValidation(result, parsed.data.horarios);

  return NextResponse.json({ ...result, id: saved.id });
}
