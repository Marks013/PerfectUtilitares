import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("MANAGE_CONFIG");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-excel-device-revoke",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await context.params;
  if (!id || id.length > 64) {
    return jsonError(
      400,
      "UNIMED_EXCEL_DEVICE_INVALID",
      "A autorização informada é inválida.",
    );
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.unimedExcelDevice.updateMany({
      where: { id, tenantId: access.tenantId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (changed.count > 0) {
      await tx.auditLog.create({
        data: {
          action: "REVOKE",
          entity: "UnimedExcelDevice",
          entityId: id,
          metadata: {
            tenantId: access.tenantId,
            moduleSessionId: access.moduleSessionId,
          },
        },
      });
    }
    return changed;
  });

  if (result.count === 0) {
    return jsonError(
      404,
      "UNIMED_EXCEL_DEVICE_NOT_FOUND",
      "Esta autorização não existe ou já foi revogada.",
    );
  }

  const response = NextResponse.json({ revoked: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function GET() {
  return methodNotAllowed(["DELETE"]);
}

export function POST() {
  return methodNotAllowed(["DELETE"]);
}

export function PUT() {
  return methodNotAllowed(["DELETE"]);
}
