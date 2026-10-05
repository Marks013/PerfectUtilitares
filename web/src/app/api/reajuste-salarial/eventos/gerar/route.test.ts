import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { beforeSendScrubber } from "@/sentry.shared";
import { PDFDocument } from "pdf-lib";
import { eventRequest, presenceEventRequest } from "@/lib/reajuste-salarial/event-adjustment-test-support";
import { recordUserUsage } from "@/lib/usage/record";
import { runWithReajusteProcessingSlot } from "@/lib/reajuste-salarial/processing-gate";
import { GET, POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "test" } }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/reajuste-salarial/access.server", () => ({ requireReajusteAccess: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/api/security", async (original) => ({ ...await original<typeof import("@/lib/api/security")>(), requireSameOrigin: vi.fn(() => null), enforcePersistentRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/api/resource-capacity", () => ({ requireResourceCapacity: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/reajuste-salarial/processing-gate", () => ({ runWithReajusteProcessingSlot: vi.fn(async (operation: () => Promise<Response>) => ({ status: "acquired", value: await operation() })) }));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: vi.fn().mockResolvedValue(undefined) }));

describe("event PDF API", () => {
  it("returns a real PDF with the latest-presence filter and rejects invalid options", async () => {
    const response = await POST(await presenceEventRequest());
    expect(response.status).toBe(200);
    const document = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect((await POST(await presenceEventRequest("yes"))).status).toBe(400);
  });
  it("imports a real workbook, calculates and returns a real readable PDF", async () => {
    const response = await POST(eventRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("reajuste-eventos-06-2026-a-06-2026.pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(recordUserUsage).toHaveBeenCalledWith(expect.objectContaining({ operation: "REAJUSTE_EVENTOS_565_901", outputBytes: bytes.length }));
  });
  it("blocks pending quantities and requires at least one target", async () => {
    const pending = await POST(eventRequest({}, "171,00"));
    expect(pending.status).toBe(409);
    expect((await pending.json()).error.code).toBe("REAJUSTE_EVENTS_PENDING");
    expect((await POST(eventRequest({ bonusNewValue: "", sundayNewValue: "" }))).status).toBe(400);
  });
  it("returns 405 for GET and a retriable response when processing capacity is busy", async () => {
    expect(GET().status).toBe(405);
    vi.mocked(runWithReajusteProcessingSlot).mockResolvedValueOnce({ status: "busy" });
    const busy = await POST(eventRequest());
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
  });
  it("keeps the failure correlation after privacy scrubbing without sending payroll payload", async () => {
    vi.mocked(recordUserUsage).mockRejectedValueOnce(new Error("PRIVATE_EMPLOYEE_PAYLOAD"));
    const response = await POST(eventRequest());
    expect(response.status).toBe(503);
    const body = await response.json();
    const correlationId = body.error.message.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
    expect(correlationId).toBeDefined();
    const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("PRIVATE_EMPLOYEE_PAYLOAD");
    expect(JSON.stringify(context)).not.toContain("PRIVATE_EMPLOYEE_PAYLOAD");
    const captureContext = context as { tags: Record<string, string>; extra: Record<string, unknown> };
    const scrubbed = beforeSendScrubber({ tags: captureContext.tags, extra: captureContext.extra });
    expect(scrubbed?.tags.correlationId).toBe(correlationId);
    expect(scrubbed?.extra).toBeUndefined();
  });
});
