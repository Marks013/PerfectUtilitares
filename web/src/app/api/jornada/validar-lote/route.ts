import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireModuleAccess,
  requireSameOrigin,
} from "@/lib/api/security";
import { DEFAULT_JORNADA_BATCH_CONFIG, validarJornadaBatchXlsx } from "@/lib/jornada/batch-validation";
import type { JornadaBatchConfig } from "@/lib/jornada/batch-validation";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function parseBoolean(value: FormDataEntryValue | null, fallback: boolean) {
  if (value == null) return fallback;
  return value === "true" || value === "on" || value === "1";
}

function parsePositiveInteger(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(formData: FormData): JornadaBatchConfig {
  return {
    validarPeriodos: parseBoolean(
      formData.get("validarPeriodos"),
      DEFAULT_JORNADA_BATCH_CONFIG.validarPeriodos,
    ),
    validarJornada: parseBoolean(
      formData.get("validarJornada"),
      DEFAULT_JORNADA_BATCH_CONFIG.validarJornada,
    ),
    validarIntervalos: parseBoolean(
      formData.get("validarIntervalos"),
      DEFAULT_JORNADA_BATCH_CONFIG.validarIntervalos,
    ),
    usarHorariosAgrupados: parseBoolean(
      formData.get("usarHorariosAgrupados"),
      DEFAULT_JORNADA_BATCH_CONFIG.usarHorariosAgrupados,
    ),
    linhaInicio: parsePositiveInteger(
      formData.get("linhaInicio"),
      DEFAULT_JORNADA_BATCH_CONFIG.linhaInicio,
    ),
    colunaHorariosAgrupados: parsePositiveInteger(
      formData.get("colunaHorariosAgrupados"),
      DEFAULT_JORNADA_BATCH_CONFIG.colunaHorariosAgrupados,
    ),
  };
}

function getUploadedFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("Envie uma planilha .xlsx no campo 'file'.");
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Formato não suportado. Envie uma planilha .xlsx.");
  }

  if (file.size === 0) {
    throw new Error("O arquivo enviado está vazio.");
  }

  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("O arquivo ultrapassa o limite de 8MB.");
  }

  return file;
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  try {
    const guard = await requireModuleAccess("jornada");
    if (!guard.ok) {
      return guard.response;
    }

    const originError = requireSameOrigin(request);
    if (originError) {
      return originError;
    }

    const limited = enforceRateLimit(request, {
      keyPrefix: "jornada-validar-lote",
      limit: 12,
      windowMs: 60_000,
    });
    if (limited) {
      return limited;
    }

    const tooLarge = requireMaxContentLength(request, MAX_IMPORT_BYTES);
    if (tooLarge) {
      return tooLarge;
    }

    const contentTypeError = requireContentType(request, ["multipart/form-data"]);
    if (contentTypeError) {
      return contentTypeError;
    }

    const formData = await request.formData();
    const file = getUploadedFile(formData);
    const config = getConfig(formData);
    const [rules, codigos] = await Promise.all([
      prisma.jornadaRule.findMany({ where: { active: true } }),
      prisma.codigoJornada.findMany(),
    ]);
    const codigoByHorario = new Map(
      codigos.map((codigo) => [codigo.horariosNormalizado, codigo.codigo]),
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: file.name,
      config,
      rules,
      codigoByHorario,
    });

    return NextResponse.json(report);
  } catch (error) {
    return jsonError(
      400,
      "JORNADA_BATCH_VALIDATION_FAILED",
      error instanceof Error
        ? error.message
        : "Erro inesperado ao validar a planilha.",
    );
  }
}
