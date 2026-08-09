import { NextResponse } from "next/server";
import { z } from "zod";

import {
  jsonError,
  methodNotAllowed,
  requireSameOrigin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";
import { requireUnimedAccess } from "@/lib/unimed/access.server";

export const runtime = "nodejs";

const revokeSchema = z.object({ deviceKey: z.string().uuid() }).strict();

export async function GET() {
  const access = await requireUnimedAccess("MANAGE_ACCESS");
  if (!access.ok) return access.response;

  const devices = await prisma.unimedOfflineDevice.findMany({
    where: { tenantId: access.tenantId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      deviceKey: true,
      label: true,
      registeredBy: true,
      lastSeenAt: true,
      offlineExpiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  const response = NextResponse.json({ devices });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("MANAGE_ACCESS");
  if (!access.ok) return access.response;

  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_OFFLINE_DEVICE_INVALID",
      "Informe um dispositivo válido para revogar.",
    );
  }
  const revoked = await prisma.unimedOfflineDevice.updateMany({
    where: {
      tenantId: access.tenantId,
      deviceKey: parsed.data.deviceKey,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  const response = NextResponse.json({ revoked: revoked.count === 1 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function POST() {
  return methodNotAllowed(["GET", "DELETE"]);
}
