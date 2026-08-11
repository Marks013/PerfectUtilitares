import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
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
import { createUnimedExcelToken } from "@/lib/unimed/excel-device";

export const runtime = "nodejs";

const createDeviceSchema = z.object({
  label: z.string().trim().min(2).max(80),
  expiresInDays: z.coerce.number().int().min(7).max(365).default(180),
});

function serializeDevice(device: {
  id: string;
  label: string;
  tokenPrefix: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: device.id,
    label: device.label,
    tokenPrefix: device.tokenPrefix,
    expiresAt: device.expiresAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
    lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  };
}

export async function GET() {
  const access = await requireUnimedAccess("MANAGE_CONFIG");
  if (!access.ok) return access.response;

  const devices = await prisma.unimedExcelDevice.findMany({
    where: { tenantId: access.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const response = NextResponse.json({ devices: devices.map(serializeDevice) });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("MANAGE_CONFIG");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-excel-device-create",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const typeError = requireContentType(request, ["application/json"]);
  if (typeError) return typeError;
  const lengthError = requireMaxContentLength(request, 16 * 1024);
  if (lengthError) return lengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = createDeviceSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_EXCEL_DEVICE_INVALID",
      "Informe um nome para a planilha e uma validade entre 7 e 365 dias.",
    );
  }

  const now = new Date();
  const activeCount = await prisma.unimedExcelDevice.count({
    where: {
      tenantId: access.tenantId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (activeCount >= 10) {
    return jsonError(
      409,
      "UNIMED_EXCEL_DEVICE_LIMIT",
      "O limite de 10 planilhas autorizadas foi atingido. Revogue uma autorização antiga para continuar.",
    );
  }

  const generated = createUnimedExcelToken();
  const expiresAt = new Date(
    now.getTime() + parsed.data.expiresInDays * 24 * 60 * 60_000,
  );
  const device = await prisma.$transaction(async (tx) => {
    const created = await tx.unimedExcelDevice.create({
      data: {
        tenantId: access.tenantId,
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.tokenPrefix,
        label: parsed.data.label,
        createdBy: access.moduleSessionId,
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        entity: "UnimedExcelDevice",
        entityId: created.id,
        metadata: {
          tenantId: access.tenantId,
          moduleSessionId: access.moduleSessionId,
          label: created.label,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
    });
    return created;
  });

  return NextResponse.json(
    { device: serializeDevice(device), token: generated.token },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export function PUT() {
  return methodNotAllowed(["GET", "POST"]);
}

export function DELETE() {
  return methodNotAllowed(["GET", "POST"]);
}
