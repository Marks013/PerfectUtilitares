// PERFECT_PDF_FULL32_V2_2
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDF_COMPRESSION_PROTOCOL_REVISION } from "./compression-types";

export type PdfWorkerHeartbeat = {
  pid: number;
  updatedAt: string;
  revision: string;
  protocolRevision: string;
};

export function currentPdfCompressionRevision() {
  const revision = process.env.SOURCE_REVISION?.trim();
  return revision && revision !== "unknown"
    ? revision
    : PDF_COMPRESSION_PROTOCOL_REVISION;
}

export function currentPdfCompressionProtocolRevision() {
  return PDF_COMPRESSION_PROTOCOL_REVISION;
}

export function pdfWorkerHeartbeatPath() {
  const configured = process.env.PDF_WORKER_HEARTBEAT_PATH?.trim();
  if (configured) return configured;
  return path.join(
    process.env.PDF_STORAGE_DIR ?? "/data/pdf-jobs",
    ".perfect-pdf-worker-heartbeat",
  );
}

export function pdfWorkerHeartbeatMaxAgeMs() {
  const configured = Number(
    process.env.PDF_WORKER_HEARTBEAT_MAX_AGE_SECONDS ?? 90,
  );
  const seconds =
    Number.isFinite(configured) && configured >= 30 && configured <= 600
      ? configured
      : 90;
  return seconds * 1_000;
}

function isHeartbeat(value: unknown): value is PdfWorkerHeartbeat {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdfWorkerHeartbeat>;
  return (
    typeof candidate.pid === "number" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.revision === "string" &&
    typeof candidate.protocolRevision === "string"
  );
}

export async function readPdfWorkerCompatibility() {
  const expectedRevision = currentPdfCompressionRevision();
  const heartbeatPath = pdfWorkerHeartbeatPath();

  let heartbeat: PdfWorkerHeartbeat;
  try {
    const parsed = JSON.parse(await readFile(heartbeatPath, "utf8")) as unknown;
    if (!isHeartbeat(parsed)) {
      return {
        ok: false as const,
        code: "PDF_WORKER_VERSION_MISMATCH",
        message:
          "O worker PDF ativo não publica uma revisão compatível. Recrie app e pdf-worker na mesma revisão.",
        expectedRevision,
        workerRevision: null,
      };
    }
    heartbeat = parsed;
  } catch {
    return {
      ok: false as const,
      code: "PDF_WORKER_UNAVAILABLE",
      message:
        "O worker PDF ainda não publicou um heartbeat válido. Verifique/recrie o serviço pdf-worker.",
      expectedRevision,
      workerRevision: null,
    };
  }

  const updatedAt = Date.parse(heartbeat.updatedAt);
  if (
    !Number.isFinite(updatedAt) ||
    Date.now() - updatedAt > pdfWorkerHeartbeatMaxAgeMs()
  ) {
    return {
      ok: false as const,
      code: "PDF_WORKER_UNAVAILABLE",
      message:
        "O heartbeat do worker PDF está expirado. O job não será enfileirado até o worker voltar a ficar saudável.",
      expectedRevision,
      workerRevision: heartbeat.revision,
    };
  }

  if (
    heartbeat.protocolRevision !== PDF_COMPRESSION_PROTOCOL_REVISION ||
    heartbeat.revision !== expectedRevision
  ) {
    return {
      ok: false as const,
      code: "PDF_WORKER_VERSION_MISMATCH",
      message: `App (${expectedRevision}) e worker (${heartbeat.revision}) estão em revisões incompatíveis.`,
      expectedRevision,
      workerRevision: heartbeat.revision,
    };
  }

  return {
    ok: true as const,
    code: null,
    message: null,
    expectedRevision,
    workerRevision: heartbeat.revision,
    heartbeat,
  };
}
