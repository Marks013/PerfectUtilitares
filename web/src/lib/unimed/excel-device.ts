import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api/security";

const TOKEN_PREFIX = "pu_unimed_";
const LAST_USED_WRITE_INTERVAL_MS = 15 * 60_000;

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createUnimedExcelToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashToken(token),
    tokenPrefix: `${token.slice(0, TOKEN_PREFIX.length + 8)}...`,
  };
}

export async function authenticateUnimedExcelDevice(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim();

  if (!token?.startsWith(TOKEN_PREFIX) || token.length > 256) {
    return {
      ok: false as const,
      response: jsonError(
        401,
        "UNIMED_EXCEL_UNAUTHORIZED",
        "A planilha não está autorizada. Gere uma nova autorização nas configurações da Unimed.",
      ),
    };
  }

  const now = new Date();
  const device = await prisma.unimedExcelDevice.findFirst({
    where: {
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      tenantId: true,
      label: true,
      lastUsedAt: true,
    },
  });

  if (!device) {
    return {
      ok: false as const,
      response: jsonError(
        401,
        "UNIMED_EXCEL_UNAUTHORIZED",
        "A autorização desta planilha expirou ou foi revogada. Gere uma nova nas configurações da Unimed.",
      ),
    };
  }

  if (
    !device.lastUsedAt ||
    now.getTime() - device.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
  ) {
    await prisma.unimedExcelDevice.updateMany({
      where: { id: device.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
  }

  return {
    ok: true as const,
    deviceId: device.id,
    tenantId: device.tenantId,
    label: device.label,
  };
}
