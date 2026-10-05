import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { eventRequest, presenceEventRequest } from "@/lib/reajuste-salarial/event-adjustment-test-support";
import { requireSameOrigin, enforcePersistentRateLimit } from "@/lib/api/security";
import { requireReajusteAccess } from "@/lib/reajuste-salarial/access.server";
import { GET, POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "test" } }) }));
vi.mock("@/lib/reajuste-salarial/access.server", () => ({ requireReajusteAccess: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/api/security", async (original) => ({ ...await original<typeof import("@/lib/api/security")>(), requireSameOrigin: vi.fn(() => null), enforcePersistentRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/api/resource-capacity", () => ({ requireResourceCapacity: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/reajuste-salarial/processing-gate", () => ({ runWithReajusteProcessingSlot: vi.fn(async (operation: () => Promise<Response>) => ({ status: "acquired", value: await operation() })) }));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: vi.fn().mockResolvedValue(undefined) }));

describe("event analysis API", () => {
  it("filters real XLSX analysis and recomputes amounts; false keeps historical employees", async () => {
    const filtered = await POST(await presenceEventRequest());
    expect(filtered.status).toBe(200);
    const { report } = await filtered.json();
    expect(report).toMatchObject({ excludeAbsentLatest: true, employeeCount: 1, bonusTotalCents: "1000", sundayTotalCents: "1500", grandTotalCents: "2500" });
    expect(report.employees.map((employee: { registration: string }) => employee.registration)).toEqual(["2"]);
    const kept = await POST(await presenceEventRequest("false"));
    expect(kept.status).toBe(200);
    expect((await kept.json()).report).toMatchObject({ excludeAbsentLatest: false, employeeCount: 2, grandTotalCents: "4500" });
    expect((await POST(await presenceEventRequest("yes"))).status).toBe(400);
  });
  beforeEach(() => { vi.clearAllMocks(); });
  it("imports a real XLSX, excludes summaries and returns exact employee differences", async () => {
    const response = await POST(eventRequest());
    expect(response.status).toBe(200);
    const { report } = await response.json();
    expect(report).toMatchObject({ employeeCount: 1, bonusTotalCents: "1000", sundayTotalCents: "1000", grandTotalCents: "2000", issueCount: 0 });
    expect(report.employees[0].months[0].indemnity901).toMatchObject({ received: true, quantity: 2, quantitySource: "amount", paidCents: "17000", targetCents: "18000" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("supports detection without targets and previews ambiguous quantities", async () => {
    const detected = await POST(eventRequest({ bonusNewValue: "", sundayNewValue: "" }));
    expect(detected.status).toBe(200);
    expect((await detected.json()).report.grandTotalCents).toBe("0");
    const pending = await POST(eventRequest({}, "171,00"));
    expect(pending.status).toBe(200);
    const { report } = await pending.json();
    expect(report.issueCount).toBe(1);
    expect(report.employees[0].months[0].indemnity901.quantity).toBeNull();
  });
  it("accepts historical overrides and rejects duplicate or unrelated competencies", async () => {
    const response = await POST(eventRequest({ historicOverrides: JSON.stringify([{ competencyKey: "06-2026", bonusOldValue: "80,00", sundayOldValue: "170,00" }]) }));
    expect(response.status).toBe(200);
    expect((await response.json()).report.employees[0].months[0].indemnity901.quantity).toBe(1);
    expect((await POST(eventRequest({}, undefined, true))).status).toBe(400);
    expect((await POST(eventRequest({ historicOverrides: JSON.stringify([{ competencyKey: "07-2026", bonusOldValue: "80,00", sundayOldValue: "85,00" }]) }))).status).toBe(400);
  });
  it.each([{ bonusOldValue: "0,00" }, { sundayNewValue: "inválido" }, { historicOverrides: "{}" }, { bonusOldValue: "-80" }] as Array<Record<string, string>>)("rejects invalid money or override settings %j", async (settings) => {
    expect((await POST(eventRequest(settings))).status).toBe(400);
  });
  it("rejects missing declared length, unsupported method and cross-origin request", async () => {
    const request = eventRequest(); request.headers.delete("content-length");
    expect((await POST(request)).status).toBe(411);
    expect(GET().status).toBe(405);
    vi.mocked(requireSameOrigin).mockReturnValueOnce(NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
    expect((await POST(eventRequest())).status).toBe(403);
  });
  it("respects access and rate limit before processing the workbook", async () => {
    vi.mocked(requireReajusteAccess).mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) });
    expect((await POST(eventRequest())).status).toBe(401);
    vi.mocked(enforcePersistentRateLimit).mockResolvedValueOnce(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));
    expect((await POST(eventRequest())).status).toBe(429);
  });
});
