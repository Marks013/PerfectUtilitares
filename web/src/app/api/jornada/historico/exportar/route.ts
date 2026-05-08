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
import { generateJornadaHistoryPdf } from "@/lib/jornada/pdf";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const requestSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(100),
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
    keyPrefix: "jornada-historico-exportar",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
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
      "Selecione ao menos uma jornada válida",
      parsed.error.issues,
    );
  }

  const ids = [...new Set(parsed.data.ids)];
  const records = await prisma.jornadaValidation.findMany({
    where: {
      id: { in: ids },
      valido: true,
      ...(guard.session.user.role === "ADMIN"
        ? {}
        : { userId: guard.session.user.id }),
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (records.length === 0) {
    return jsonError(
      404,
      "NOT_FOUND",
      "Nenhuma jornada selecionada foi encontrada",
    );
  }

  if (records.length !== ids.length) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Selecione apenas jornadas válidas para gerar o PDF",
    );
  }

  const pdf = await generateJornadaHistoryPdf(records);

  await prisma.auditLog.create({
    data: {
      userId: guard.session.user.id,
      action: "JORNADA_HISTORY_PDF_EXPORTED",
      entity: "JornadaValidation",
      metadata: {
        count: records.length,
        ids: records.map((record) => record.id),
      },
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="historico-jornadas.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
