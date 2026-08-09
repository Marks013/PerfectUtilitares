import { NextResponse } from "next/server";
import { z } from "zod";

import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import { buildUnimedOfflineBundle } from "@/lib/unimed/offline-bundle";
import {
  registerOrRefreshUnimedOfflineDevice,
  UnimedOfflineDeviceError,
} from "@/lib/unimed/offline-device.server";

export const runtime = "nodejs";

const deviceKeySchema = z.string().uuid();

export async function GET(request: Request) {
  const access = await requireUnimedAccess("VIEW");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-offline-bootstrap",
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const parsedDeviceKey = deviceKeySchema.safeParse(
    request.headers.get("x-unimed-device-id"),
  );
  if (!parsedDeviceKey.success) {
    return jsonError(
      400,
      "UNIMED_OFFLINE_DEVICE_INVALID",
      "Não foi possível identificar este dispositivo.",
    );
  }

  try {
    const device = await registerOrRefreshUnimedOfflineDevice({
      deviceKey: parsedDeviceKey.data,
      label: request.headers.get("x-unimed-device-label"),
      operatorName: access.operatorName,
      tenantId: access.tenantId,
      userAgent: request.headers.get("user-agent"),
    });
    const bundle = await buildUnimedOfflineBundle(
      access.tenantId,
      device.offlineExpiresAt,
    );
    const response = NextResponse.json({ bundle, device });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof UnimedOfflineDeviceError) {
      return jsonError(403, error.code, error.message);
    }
    const correlationId = crypto.randomUUID();
    console.error("Unexpected Unimed offline bootstrap failure", {
      correlationId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(
      503,
      "UNIMED_OFFLINE_BOOTSTRAP_FAILED",
      `Não foi possível preparar o modo offline. Código: ${correlationId}`,
    );
  }
}

export function POST() {
  return methodNotAllowed(["GET"]);
}
