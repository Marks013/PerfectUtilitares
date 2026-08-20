import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import { prisma } from "@/lib/prisma";
import { UnimedDocumentError } from "@/lib/unimed/documents";
import {
  queueUnimedDocumentPdf,
  UnimedDocumentPdfError,
} from "@/lib/unimed/document-pdf";
import {
  unimedDocumentRequestSchema,
  zodIssueDetails,
} from "@/lib/unimed/schema";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["POST"]);
}

function publicDocumentError(error: UnimedDocumentError) {
  const messages: Record<UnimedDocumentError["code"], string> = {
    UNIMED_DOCUMENT_BENEFICIARY_NOT_FOUND:
      "Beneficiário não encontrado na competência ativa.",
    UNIMED_DOCUMENT_REASON_MISMATCH:
      "O motivo selecionado não corresponde ao tipo do beneficiário.",
    UNIMED_DOCUMENT_CPF_REQUIRED:
      "O beneficiário precisa ter um CPF válido para gerar o documento.",
    UNIMED_DOCUMENT_DEPENDENT_LIMIT:
      "O RN561 comporta no máximo seis dependentes. Revise a seleção.",
    UNIMED_DOCUMENT_TEMPLATE_NOT_CONFIGURED:
      "Os modelos de documento ainda não foram configurados no servidor.",
    UNIMED_DOCUMENT_TEMPLATE_UNAVAILABLE:
      "O modelo de documento está indisponível no servidor.",
    UNIMED_DOCUMENT_TEMPLATE_UNVERIFIED:
      "O modelo de documento foi alterado e precisa ser validado antes do uso.",
    UNIMED_DOCUMENT_TEMPLATE_INVALID:
      "O modelo de documento não possui a estrutura validada.",
  };
  return jsonError(error.status, error.code, messages[error.code]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("GENERATE_DOCUMENT");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-documents",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = unimedDocumentRequestSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_DOCUMENT_CONFIRMATION_REQUIRED",
      "Confirme a geração e selecione beneficiário e motivo válidos.",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const reason = await prisma.unimedExclusionReason.findFirst({
      where: {
        tenantId: access.tenantId,
        code: parsed.data.reasonCode,
        active: true,
      },
      select: { documentKind: true },
    });
    if (!reason || reason.documentKind === "NONE") {
      return jsonError(
        422,
        "UNIMED_DOCUMENT_REASON_UNSUPPORTED",
        "Este motivo não possui documento automático.",
      );
    }
    const job = await queueUnimedDocumentPdf({
      beneficiaryId: parsed.data.beneficiaryId,
      dependentIds: parsed.data.dependentIds,
      manualDependents: parsed.data.manualDependents,
      documentKind: reason.documentKind,
      moduleSessionId: access.moduleSessionId,
      reasonCode: parsed.data.reasonCode,
      tenantId: access.tenantId,
    });
    return Response.json(
      { job },
      {
        status: 202,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof UnimedDocumentError) {
      return publicDocumentError(error);
    }
    if (error instanceof UnimedDocumentPdfError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(
      503,
      "UNIMED_DOCUMENT_FAILED",
      "Não foi possível gerar o documento. Tente novamente.",
    );
  }
}
