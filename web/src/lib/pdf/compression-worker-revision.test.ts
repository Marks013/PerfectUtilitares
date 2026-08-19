// PERFECT_PDF_FULL32_V2_2
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentPdfCompressionRevision,
  readPdfWorkerCompatibility,
} from "./compression-worker-revision";
import { PDF_COMPRESSION_PROTOCOL_REVISION } from "./compression-types";

const directories: string[] = [];
const originalHeartbeat = process.env.PDF_WORKER_HEARTBEAT_PATH;
const originalRevision = process.env.SOURCE_REVISION;

afterEach(async () => {
  process.env.PDF_WORKER_HEARTBEAT_PATH = originalHeartbeat;
  process.env.SOURCE_REVISION = originalRevision;
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function heartbeatFile() {
  const directory = await mkdtemp(path.join(tmpdir(), "pdf-worker-revision-"));
  directories.push(directory);
  const file = path.join(directory, "heartbeat.json");
  process.env.PDF_WORKER_HEARTBEAT_PATH = file;
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
