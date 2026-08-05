import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createQueue: vi.fn().mockResolvedValue(undefined),
  getQueue: vi.fn().mockResolvedValue({ name: "perfect-pdf-processing" }),
  on: vi.fn(),
  send: vi.fn().mockResolvedValueOnce("queue-row").mockResolvedValueOnce(null),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    createQueue = mocks.createQueue;
    getQueue = mocks.getQueue;
    on = mocks.on;
    send = mocks.send;
    start = mocks.start;
    stop = mocks.stop;
  },
}));

import {
  enqueuePdfJob,
  getPdfQueueJobId,
  stopPdfQueue,
} from "@/lib/pdf/queue";

const previousDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://queue-test.invalid/database";
});

afterAll(async () => {
  await stopPdfQueue();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("PDF queue publication", () => {
  it("uses one deterministic queue row id for repeated publication attempts", async () => {
    const principal = { key: "principal-1", tier: "authenticated" } as const;

    await enqueuePdfJob("job-12345678", principal);
    await enqueuePdfJob("job-12345678", principal);

    const expectedId = getPdfQueueJobId("job-12345678");
    expect(expectedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ id: expectedId, singletonKey: "job-12345678" }),
    );
    expect(mocks.send.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ id: expectedId, singletonKey: "job-12345678" }),
    );
  });
});
