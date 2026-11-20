import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ account: vi.fn(), module: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.account }));
vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: mocks.module }));
vi.mock("@/components/escalas/escalas-workspace", () => ({ EscalasWorkspace: () => <p>Planejamento protegido</p> }));
import EscalaPage from "./page";
beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue(null); mocks.module.mockResolvedValue(null); });
describe("public link with protected Escalas workspace", () => {
  it("shows the operational password form without exposing the workspace to an anonymous visitor", async () => {
    const html = renderToStaticMarkup(await EscalaPage()); expect(html).toContain("Senha operacional"); expect(html).not.toContain("Planejamento protegido"); expect(html).not.toContain("tenantId");
  });
  it("preserves an active account workspace without requiring the shared password", async () => {
    mocks.account.mockResolvedValue({ user: { id: "u1", status: "ACTIVE", tenantId: "company-other", role: "OPERATOR" } });
    expect(renderToStaticMarkup(await EscalaPage())).toContain("Planejamento protegido"); expect(mocks.module).not.toHaveBeenCalled();
  });
  it("mounts only a verified operational session and exposes the separate lock control", async () => {
    mocks.module.mockResolvedValue({ id: "s1", tenantId: "company-default", expiresAt: new Date("2030-01-01") });
    const html = renderToStaticMarkup(await EscalaPage()); expect(html).toContain("Planejamento protegido"); expect(html).toContain("Bloquear Escalas"); expect(html).not.toContain("company-default");
  });
});


it.each([{ status: "BLOCKED", tenantId: "company" }, { status: "BANNED", tenantId: "company" }, { status: "ACTIVE", tenantId: null }])("does not mount an operational workspace for an account denied by the API: %j", async user => {
  mocks.account.mockResolvedValue({ user: { id: "blocked-account", ...user } });
  mocks.module.mockResolvedValue({ id: "valid-cookie", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const html = renderToStaticMarkup(await EscalaPage());
  expect(html).toContain("Acesso a Escalas indisponível para esta conta");
  expect(html).not.toContain("Planejamento protegido"); expect(html).not.toContain("Senha operacional");
  expect(mocks.module).not.toHaveBeenCalled();
});
