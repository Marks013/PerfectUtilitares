import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class UnimedOfflineDeviceError extends Error {
  readonly code = "UNIMED_OFFLINE_DEVICE_REVOKED";

  constructor() {
    super("Este dispositivo foi revogado. Conecte-se com um dispositivo autorizado.");
    this.name = "UnimedOfflineDeviceError";
  }
}

function safeLabel(value: string | null) {
  const normalized = Array.from(value ?? "Navegador")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 64);
  return normalized || "Navegador";
}

export async function registerOrRefreshUnimedOfflineDevice(input: {
  deviceKey: string;
  label: string | null;
  operatorName: string;
  tenantId: string;
  userAgent: string | null;
}) {
  const existing = await prisma.unimedOfflineDevice.findUnique({
    where: {
      tenantId_deviceKey: {
        tenantId: input.tenantId,
        deviceKey: input.deviceKey,
      },
    },
    select: { id: true, revokedAt: true },
  });
  if (existing?.revokedAt) throw new UnimedOfflineDeviceError();

  const now = new Date();
  const offlineExpiresAt = new Date(now.getTime() + OFFLINE_TTL_MS);
  const device = await prisma.unimedOfflineDevice.upsert({
    where: {
      tenantId_deviceKey: {
        tenantId: input.tenantId,
        deviceKey: input.deviceKey,
      },
    },
    create: {
      tenantId: input.tenantId,
      deviceKey: input.deviceKey,
      label: safeLabel(input.label),
      userAgentHash: createHash("sha256")
        .update(input.userAgent ?? "unknown")
        .digest("hex"),
      registeredBy: input.operatorName,
      lastSeenAt: now,
      offlineExpiresAt,
    },
    update: {
      label: safeLabel(input.label),
      userAgentHash: createHash("sha256")
        .update(input.userAgent ?? "unknown")
        .digest("hex"),
      lastSeenAt: now,
      offlineExpiresAt,
    },
    select: {
      deviceKey: true,
      label: true,
      offlineExpiresAt: true,
    },
  });

  return device;
}
