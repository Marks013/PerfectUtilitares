import { readFile, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";

const GIB = 1024 ** 3;
const STATUS_MAX_AGE_MS = 10 * 60 * 1_000;
const HOST_GUARD_STATUS_PATH = "/run/server-resource-guard/status.json";

type HostGuardStatus = {
  acceptingHeavyJobs?: boolean;
  generatedAt?: string;
  severity?: string;
};

export type ResourceCapacitySnapshot = {
  availableBytes: number;
  totalBytes: number;
  usedPercent: number;
  hostGuardBlocks: boolean;
};

export type ResourceCapacityConfig = {
  blockUsedPercent: number;
  minimumFreeBytes: number;
};

export type ResourceCapacityRequest = {
  inputBytes?: number;
  multiplier?: number;
  storagePath?: string;
};

export type ResourceCapacityDecision = {
  allowed: boolean;
  code?: "HOST_RESOURCE_PRESSURE" | "STORAGE_CAPACITY_LOW";
  estimatedWorkingBytes: number;
};

export class ResourceCapacityError extends Error {
  constructor(
    public readonly code:
      | "HOST_RESOURCE_PRESSURE"
      | "STORAGE_CAPACITY_LOW"
      | "PDF_QUEUE_CAPACITY_REACHED",
    message: string,
  ) {
    super(message);
    this.name = "ResourceCapacityError";
  }
}

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCapacityConfig(): ResourceCapacityConfig {
  return {
    blockUsedPercent: readPositiveNumber(
      process.env.STORAGE_BLOCK_USED_PERCENT,
      80,
    ),
    minimumFreeBytes: readPositiveNumber(
      process.env.STORAGE_MIN_FREE_BYTES,
      30 * GIB,
    ),
  };
}

async function readHostGuardStatus(): Promise<HostGuardStatus | null> {
  try {
    const parsed = JSON.parse(
      await readFile(HOST_GUARD_STATUS_PATH, "utf8"),
    ) as HostGuardStatus;
    const generatedAt = Date.parse(parsed.generatedAt ?? "");
    if (
      !Number.isFinite(generatedAt) ||
      Date.now() - generatedAt > STATUS_MAX_AGE_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function evaluateResourceCapacity(
  snapshot: ResourceCapacitySnapshot,
  request: ResourceCapacityRequest,
  config: ResourceCapacityConfig,
): ResourceCapacityDecision {
  const inputBytes = Math.max(0, request.inputBytes ?? 0);
  const multiplier = Math.max(1, request.multiplier ?? 1);
  const estimatedWorkingBytes = Math.ceil(inputBytes * multiplier);

  if (snapshot.hostGuardBlocks) {
    return {
      allowed: false,
      code: "HOST_RESOURCE_PRESSURE",
      estimatedWorkingBytes,
    };
  }

  if (
    snapshot.usedPercent >= config.blockUsedPercent ||
    snapshot.availableBytes - estimatedWorkingBytes < config.minimumFreeBytes
  ) {
    return {
      allowed: false,
      code: "STORAGE_CAPACITY_LOW",
      estimatedWorkingBytes,
    };
  }

  return { allowed: true, estimatedWorkingBytes };
}

export function getRequestContentLength(request: Request) {
  const parsed = Number(request.headers.get("content-length"));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function assertResourceCapacity(
  request: ResourceCapacityRequest = {},
) {
  const storagePath =
    request.storagePath ??
    process.env.PDF_STORAGE_DIR ??
    process.env.RESOURCE_STORAGE_PATH ??
    tmpdir();
  const [filesystem, hostGuard] = await Promise.all([
    statfs(storagePath),
    readHostGuardStatus(),
  ]);
  const totalBytes = Number(filesystem.blocks) * Number(filesystem.bsize);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const snapshot: ResourceCapacitySnapshot = {
    availableBytes,
    totalBytes,
    usedPercent:
      totalBytes > 0 ? ((totalBytes - availableBytes) / totalBytes) * 100 : 100,
    hostGuardBlocks: hostGuard?.acceptingHeavyJobs === false,
  };
  const decision = evaluateResourceCapacity(
    snapshot,
    request,
    getCapacityConfig(),
  );

  if (!decision.allowed) {
    throw new ResourceCapacityError(
      decision.code ?? "STORAGE_CAPACITY_LOW",
      "O servidor está preservando espaço e estabilidade neste momento. Aguarde alguns minutos e tente novamente; seu arquivo continua seguro no seu dispositivo.",
    );
  }

  return { ...snapshot, ...decision };
}
