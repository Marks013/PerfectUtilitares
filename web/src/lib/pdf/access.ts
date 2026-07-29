import type { Prisma } from "@prisma/client";
import type { AppSession } from "@/auth";

export function pdfJobAccessWhere(
  session: AppSession,
): Prisma.PdfJobWhereInput {
  if (session.user.role === "ADMIN") {
    return {};
  }

  return {
    tenantId: session.user.tenantId ?? "__without_tenant__",
    userId: session.user.id,
  };
}
