import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnimedGrant: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { unimedUserAccess: { findFirst: mocks.findUnimedGrant } } }));

import DashboardPage from "./page";

describe("Dashboard Escalas entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(null);
  });

  it("offers a restricted public entry without reading a private grant", async () => {
    const html = renderToStaticMarkup(await DashboardPage());
    const card = html.match(/<a\b(?=[^>]*href="\/escala")[^>]*>.*?<\/a>/s)?.[0];

    expect(card).toBeDefined();
    expect(card).toContain("Escalas 5×2");
    expect(card).toContain("Acesso restrito");
    expect(card).toContain("Acessar Escalas");
    expect(html).not.toContain('href="/unimed"');
    expect(html).not.toContain('href="/reajuste-salarial"');
    expect(mocks.findUnimedGrant).not.toHaveBeenCalled();
  });

  it("keeps the Escalas entry alongside the existing administrative cards", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN", status: "ACTIVE", tenantId: "synthetic-tenant" } });

    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain('href="/escala"');
    expect(html).toContain("Acesso restrito");
    expect(html).toContain('href="/unimed"');
    expect(html).toContain('href="/reajuste-salarial"');
  });
});
