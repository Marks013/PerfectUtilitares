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
  entries: z
    .array(
      z.object({
        ids: z.array(z.string().cuid()).min(1).max(4),
        nome: z.string().trim().min(1).max(120),
        matricula: z.string().trim().max(60).optional().default(""),
        dataAlteracao: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .min(1)
    .max(100),
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

  const contentLengthError = requireMaxContentLength(request, 64 * 1024);
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

  const entries = parsed.data.entries;
  const ids = [...new Set(entries.flatMap((entry) => entry.ids))];
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

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const pdfEntries = entries.map((entry) => ({
    nome: entry.nome,
    matricula: entry.matricula,
    dataAlteracao: entry.dataAlteracao,
    requestedCount: entry.ids.length,
    records: entry.ids
      .map((id) => recordsById.get(id))
      .filter((record): record is NonNullable<typeof record> => Boolean(record)),
  }));

  if (pdfEntries.some((entry) => entry.records.length !== entry.requestedCount)) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Selecione apenas jornadas válidas para gerar o PDF",
    );
  }

  const pdf = await generateJornadaHistoryPdf(
    pdfEntries.map(({ requestedCount: _requestedCount, ...entry }) => entry),
  );

  await prisma.auditLog.create({
    data: {
      userId: guard.session.user.id,
      action: "JORNADA_HISTORY_PDF_EXPORTED",
      entity: "JornadaValidation",
      metadata: {
        count: records.length,
        ids: records.map((record) => record.id),
        pessoas: pdfEntries.length,
      },
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="alteracao-de-jornada.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
