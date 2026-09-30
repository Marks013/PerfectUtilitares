import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { isEventsEnabled } from "@/lib/presence/feature";

afterEach(() => vi.unstubAllEnvs());

describe("temporary Events suspension", () => {
  it.each([
    "/admin/presencas", "/admin/presencas/one",
    "/api/admin/presencas/one/entregas", "/presenca/event/guest",
    "/api/presenca/acesso", "/api/presenca/event/guest/confirmacao",
    "/p/short-code", "/api/webhooks/resend",
    "/admin/presencas/event.csv", "/presenca/event/guest.png",
    "/api/admin/presencas/event/relatorio", "/api/presenca/event/guest/estado",
    "/api/presenca/event/guest/presentes/gift/reserva",
  ])("blocks %s before its handler runs", async (path) => {
    vi.stubEnv("EVENTS_ENABLED", "false");
    expect(unstable_doesMiddlewareMatch({ config, url: `https://example.test${path}` })).toBe(true);
    const response = proxy(new NextRequest(`https://example.test${path}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "O módulo Eventos está temporariamente desativado.", code: "EVENTS_DISABLED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks event writes using %s", (method) => {
    vi.stubEnv("EVENTS_ENABLED", "false");
    const response = proxy(new NextRequest("https://example.test/api/admin/presencas/event", { method }));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it.each(["/pdf", "/api/pdf/jobs", "/unimed", "/convite/account-token", "/api/presenca-outro"])(
    "preserves unrelated route %s", (path) => {
      vi.stubEnv("EVENTS_ENABLED", "false");
      expect(proxy(new NextRequest(`https://example.test${path}`)).headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("requires explicit enablement and supports reactivation", () => {
    vi.stubEnv("EVENTS_ENABLED", undefined);
    expect(isEventsEnabled()).toBe(false);
    vi.stubEnv("EVENTS_ENABLED", "true");
    expect(isEventsEnabled()).toBe(true);
    expect(proxy(new NextRequest("https://example.test/api/admin/presencas")).headers.get("x-middleware-next")).toBe("1");
  });
});
