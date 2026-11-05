import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  captureException: vi.fn(),
  cleanupExpired: vi.fn(),
  cleanupInputs: vi.fn(),
  cleanupPresence: vi.fn(),
  findUnique: vi.fn(),
  init: vi.fn(),
  processJob: vi.fn(),
  queryRaw: vi.fn(),
  reminders: vi.fn(),
  rename: vi.fn(),
  retries: vi.fn(),
  updateMany: vi.fn(),
  work: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: mocks.init,
  captureException: mocks.captureException,
}));
vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  rename: mocks.rename,
  writeFile: mocks.writeFile,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    pdfJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
  },
}));
vi.mock("@/lib/pdf/processor", () => ({ processPdfJob: mocks.processJob }));
vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueue: async () => ({ work: mocks.work }),
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
  stopPdfQueue: vi.fn(),
}));
vi.mock("@/lib/pdf/constants", () => ({
  getPdfJobExpiry: () => new Date("2026-11-06T12:00:00Z"),
}));
vi.mock("@/lib/pdf/retention", () => ({
  cleanupCompletedPdfJobInputs: mocks.cleanupInputs,
  cleanupExpiredPdfJobs: mocks.cleanupExpired,
}));
vi.mock("@/lib/presence/delivery", () => ({
  processDuePresenceReminders: mocks.reminders,
  retryDuePresenceDeliveries: mocks.retries,
}));
vi.mock("@/lib/presence/retention", () => ({
  cleanupPresenceData: mocks.cleanupPresence,
}));

const privateError = new Error("PRIVATE payload /data/private.pdf token=secret");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  vi.stubEnv("APP_URL", "https://example.test");
  vi.stubEnv("EVENTS_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  for (const mock of [
    mocks.access, mocks.cleanupExpired, mocks.cleanupInputs,
    mocks.cleanupPresence, mocks.processJob, mocks.queryRaw,
    mocks.reminders, mocks.rename, mocks.retries, mocks.work, mocks.writeFile,
  ]) mock.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // The imported worker must not register shutdown handlers on the test process.
  vi.spyOn(process, "once").mockReturnValue(process);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function expectLocalFailure(event: string, count = 1) {
  expect(console.error).toHaveBeenCalledTimes(count);
  for (const call of vi.mocked(console.error).mock.calls) {
    expect(call).toHaveLength(1);
    expect(JSON.parse(String(call[0]))).toEqual({
      timestamp: expect.any(String),
      level: "error",
      event,
    });
    expect(String(call[0])).not.toMatch(/PRIVATE|private\.pdf|secret|job-12345678/);
  }
  expect(mocks.captureException).toHaveBeenCalledWith(
    privateError, expect.any(Object),
  );
  expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
}

describe("PDF worker local failure reporting", () => {
  it("does not announce readiness after a failed heartbeat and retries normally", async () => {
    mocks.queryRaw.mockRejectedValueOnce(privateError);

    await import("@/workers/pdf-worker");

    expectLocalFailure("pdf_worker_heartbeat_failed");
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalledWith("[pdf-worker] pronto para processar documentos");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("limits repeated heartbeat logs without suppressing retries or Sentry reports", async () => {
    mocks.queryRaw.mockRejectedValue(privateError);
    await import("@/workers/pdf-worker");

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expectLocalFailure("pdf_worker_heartbeat_failed");
    expect(mocks.captureException.mock.calls.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(1);
    expectLocalFailure("pdf_worker_heartbeat_failed", 2);
  });

  it("reports retention failures locally and still runs the next scheduled cleanup", async () => {
    mocks.cleanupExpired.mockRejectedValueOnce(privateError);
    await import("@/workers/pdf-worker");
    await vi.advanceTimersByTimeAsync(0);

    expectLocalFailure("pdf_worker_retention_failed");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mocks.cleanupExpired).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("reports failed presence maintenance without marking its cleanup as complete", async () => {
    vi.stubEnv("EVENTS_ENABLED", "true");
    mocks.cleanupPresence.mockRejectedValueOnce(privateError);
    await import("@/workers/pdf-worker");
    await vi.advanceTimersByTimeAsync(0);

    expectLocalFailure("pdf_worker_presence_maintenance_failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.cleanupPresence).toHaveBeenCalledTimes(2);
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
    expect(mocks.retries).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("keeps a completed PDF successful when input cleanup fails and reports only the event", async () => {
    await import("@/workers/pdf-worker");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      artifacts: [{ sha256: "abc", sizeBytes: 10n }],
    });
    mocks.cleanupInputs.mockRejectedValueOnce(privateError);
    const handleJobs = mocks.work.mock.calls[0]?.[2] as (
      jobs: { data: { jobId: string }; retryCount: number; retryLimit: number }[],
    ) => Promise<void>;

    await expect(handleJobs([{
      data: { jobId: "job-12345678" }, retryCount: 0, retryLimit: 2,
    }])).resolves.toBeUndefined();

    expectLocalFailure("pdf_worker_input_cleanup_failed");
    expect(mocks.processJob).toHaveBeenCalledWith("job-12345678");
    expect(mocks.cleanupInputs).toHaveBeenCalledWith("job-12345678");
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-12345678", status: "SUCCEEDED" },
      data: { expiresAt: expect.any(Date) },
    });
  });
});
