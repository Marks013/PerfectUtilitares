// PERFECT_PDF_FULL32_V2_2
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentPdfCompressionRevision,
  pdfWorkerHeartbeatPath,
  readPdfWorkerCompatibility,
} from "./compression-worker-revision";
import { PDF_COMPRESSION_PROTOCOL_REVISION } from "./compression-types";

const directories: string[] = [];
const heartbeatFiles: string[] = [];
const originalHeartbeat = process.env.PDF_WORKER_HEARTBEAT_PATH;
const originalRevision = process.env.SOURCE_REVISION;

afterEach(async () => {
  process.env.PDF_WORKER_HEARTBEAT_PATH = originalHeartbeat;
  process.env.SOURCE_REVISION = originalRevision;
  await Promise.all(
    heartbeatFiles.splice(0).map((file) => rm(file, { force: true })),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function heartbeatFile() {
  const directory = await mkdtemp(path.join(tmpdir(), "pdf-worker-revision-"));
  directories.push(directory);
  process.env.PDF_WORKER_HEARTBEAT_PATH = path.join(
    directory,
    `heartbeat-${randomUUID()}.json`,
  );
  const file = pdfWorkerHeartbeatPath();
  heartbeatFiles.push(file);
  await mkdir(path.dirname(file), { recursive: true });
  return file;
}

describe("PDF worker revision compatibility", () => {
  it("rejeita worker antigo sem heartbeat compartilhado", async () => {
    await heartbeatFile();
    await expect(readPdfWorkerCompatibility()).resolves.toMatchObject({
      ok: false,
      code: "PDF_WORKER_UNAVAILABLE",
    });
  });

  it("rejeita revisão diferente", async () => {
    const file = await heartbeatFile();
    process.env.SOURCE_REVISION = "app-revision";
    await writeFile(
      file,
      JSON.stringify({
        pid: 123,
        updatedAt: new Date().toISOString(),
        revision: "worker-revision",
        protocolRevision: PDF_COMPRESSION_PROTOCOL_REVISION,
      }),
      "utf8",
    );
    await expect(readPdfWorkerCompatibility()).resolves.toMatchObject({
      ok: false,
      code: "PDF_WORKER_VERSION_MISMATCH",
    });
  });

  it("aceita heartbeat recente da mesma revisão", async () => {
    const file = await heartbeatFile();
    process.env.SOURCE_REVISION = "same-revision";
    expect(currentPdfCompressionRevision()).toBe("same-revision");
    await writeFile(
      file,
      JSON.stringify({
        pid: 123,
        updatedAt: new Date().toISOString(),
        revision: "same-revision",
        protocolRevision: PDF_COMPRESSION_PROTOCOL_REVISION,
      }),
      "utf8",
    );
    await expect(readPdfWorkerCompatibility()).resolves.toMatchObject({
      ok: true,
      workerRevision: "same-revision",
    });
  });
});
