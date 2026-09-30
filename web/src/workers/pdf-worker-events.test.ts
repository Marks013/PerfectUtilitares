import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliveryImported: vi.fn(),
  retentionImported: vi.fn(),
  reminders: vi.fn().mockResolvedValue(undefined),
  retries: vi.fn().mockResolvedValue(undefined),
  cleanupPresence: vi.fn().mockResolvedValue(undefined),
  cleanupPdf: vi.fn().mockResolvedValue(undefined),
  work: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@sentry/node", () => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/lib/pdf/processor", () => ({ processPdfJob: vi.fn() }));
vi.mock("@/lib/pdf/queue", () => ({
  getPdfQueue: vi.fn().mockResolvedValue({ work: mocks.work }),
  PDF_PROCESSING_QUEUE: "perfect-pdf-processing",
  stopPdfQueue: vi.fn(),
}));
vi.mock("@/lib/pdf/constants", () => ({ getPdfJobExpiry: vi.fn() }));
vi.mock("@/lib/pdf/retention", () => ({
  cleanupCompletedPdfJobInputs: vi.fn(),
  cleanupExpiredPdfJobs: mocks.cleanupPdf,
}));
vi.mock("@/lib/presence/delivery", () => {
  mocks.deliveryImported();
  return { processDuePresenceReminders: mocks.reminders, retryDuePresenceDeliveries: mocks.retries };
});
vi.mock("@/lib/presence/retention", () => {
  mocks.retentionImported();
  return { cleanupPresenceData: mocks.cleanupPresence };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("APP_URL", "https://example.test");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  // Do not register test-owned shutdown callbacks on the Vitest process.
  vi.spyOn(process, "once").mockReturnValue(process);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Events maintenance suspension", () => {
  it("keeps PDF work running without loading or scheduling Events", async () => {
    vi.stubEnv("EVENTS_ENABLED", "false");
    await import("@/workers/pdf-worker");
    expect(mocks.work).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mocks.cleanupPdf).toHaveBeenCalledTimes(2);
    expect(mocks.deliveryImported).not.toHaveBeenCalled();
    expect(mocks.retentionImported).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
    expect(mocks.retries).not.toHaveBeenCalled();
    expect(mocks.cleanupPresence).not.toHaveBeenCalled();
  });

  it("resumes maintenance only when explicitly enabled", async () => {
    vi.stubEnv("EVENTS_ENABLED", "true");
    await import("@/workers/pdf-worker");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(3);
    expect(mocks.reminders).toHaveBeenCalledOnce();
    expect(mocks.retries).toHaveBeenCalledOnce();
    expect(mocks.cleanupPresence).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
    expect(mocks.retries).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupPresence).toHaveBeenCalledOnce();
  });
});
