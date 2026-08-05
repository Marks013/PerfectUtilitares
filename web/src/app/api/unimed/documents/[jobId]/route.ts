import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import { getUnimedDocumentPdf } from "@/lib/unimed/document-pdf";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function validJobId(jobId: string) {
  return jobId.length >= 8 && jobId.length <= 64;
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireUnimedAccess("GENERATE_DOCUMENT");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-document-pdf-status",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { jobId } = await context.params;
  if (!validJobId(jobId)) {
    return jsonError(400, "UNIMED_DOCUMENT_JOB_INVALID", "Documento inválido.");
  }

  const result = await getUnimedDocumentPdf(
    access.tenantId,
    access.moduleSessionId,
    jobId,
  );
  if (result.state === "NOT_FOUND") {
    return jsonError(
      404,
      "UNIMED_DOCUMENT_JOB_NOT_FOUND",
      "Documento não encontrado.",
    );
  }
  if (result.state === "PENDING") {
    return NextResponse.json(
      { job: result.job },
      {
        status: 202,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": "1",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  if (result.state === "FAILED") {
    return jsonError(
      503,
      "UNIMED_DOCUMENT_PDF_FAILED",
      "Não foi possível converter o documento para PDF. Tente novamente.",
    );
  }
  if (result.state === "GONE") {
    return jsonError(
      410,
      "UNIMED_DOCUMENT_PDF_EXPIRED",
      "Este documento expirou. Gere-o novamente.",
    );
  }

  const fileName = result.fileName.replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(result.bytes.byteLength),
      "Content-Type": result.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
