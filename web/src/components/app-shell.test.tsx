import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  module: vi.fn(), pathname: "/escala" as string | null,
  session: null as null | {
    user: {
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "USER";
      status: "ACTIVE" | "BLOCKED";
      tenantId?: string;
    };
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => state.session),
}));

vi.mock("@/app/login/actions", () => ({
  logoutAction: vi.fn(),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock("@/lib/escalas/operator-session-store", () => ({ getEscalaScopedModuleSession: state.module }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
import { AppShell } from "./app-shell";

async function renderShell() {
  return renderToStaticMarkup(
    await AppShell({ children: <main>Conteúdo</main> }),
  );
}

describe("AppShell Jornada navigation", () => {
  beforeEach(() => {
    state.session = null; state.module.mockReset().mockResolvedValue(null); state.pathname = "/escala";
  });

  it("opens Jornada directly in Validar without a dropdown", async () => {
    const html = await renderShell();

    expect(html).toContain("Validador de Jornada");
    expect(html).toContain("Manutenção de PDFs");
    expect(html).toContain('href="/reajuste-salarial"');
    expect(html).toContain('href="/jornada/validar"');
    expect(html).toMatch(/<a[^>]+href="\/jornada\/validar"[^>]*>Validador de Jornada<\/a>/);
    expect(html).not.toContain("<summary");
    expect(html).not.toContain('href="/jornada/regras"');
    expect(html).not.toContain('href="/jornada/codigos"');
    expect(html).not.toContain('href="/jornada/historico"');
    expect(html).not.toContain('href="/admin/ferias"');
    expect(html).toContain('href="/escala"');
    expect(html).toContain("Escalas 5×2 · Acesso restrito");
    expect(html).not.toContain('href="/conta"');
    expect(state.module).not.toHaveBeenCalled();
  });

  it("keeps administrative navigation while Jornada options live inside the module", async () => {
    state.session = {
      user: {
        id: "admin-id",
        email: "admin@example.test",
        name: "Administrador",
        role: "ADMIN",
        status: "ACTIVE",
        tenantId: "tenant-test",
      },
    };

    const html = await renderShell();

    expect(html).toContain('href="/jornada/validar"');
    expect(html).not.toContain('href="/jornada/regras"');
    expect(html).not.toContain('href="/jornada/codigos"');
    expect(html).not.toContain('href="/jornada/historico"');
    expect(html).toContain('href="/admin/ferias"');
    expect(html).toContain('href="/escala"');
  });

  it.each([
    { role: "USER" as const, status: "ACTIVE" as const, tenantId: "tenant-test" },
    { role: "ADMIN" as const, status: "BLOCKED" as const, tenantId: "tenant-test" },
    { role: "ADMIN" as const, status: "ACTIVE" as const, tenantId: undefined },
  ])("hides Ferias without an active tenant administrator: %j", async (access) => {
    state.session = {
      user: { id: "user-test", name: "Usuário", email: "user@example.test", ...access },
    };
    expect(await renderShell()).not.toContain('href="/admin/ferias"');
  });
});


describe("Escalas canonical navigation and operational access", () => {
  beforeEach(() => { state.session = null; state.module.mockReset().mockResolvedValue(null); state.pathname = "/escala"; });
  const nominalSession = {
    kind: "resolved", sessionId: "verified", expiresAtMs: Date.parse("2099-01-01T00:00:00Z"), permissionVersion: 1, accessPolicyVersion: 1,
    principal: { kind: "operator", id: "synthetic-operator", tenantId: "default-private-tenant", active: true,
      branchGrants: [{ tenantId: "default-private-tenant", operatorId: "synthetic-operator", branchCode: "02", active: true, capabilities: ["workspace.read"] }] },
  };
  it("keeps the public Escalas link current without loading nominal session data", async () => {
    state.module.mockResolvedValue(nominalSession);
    const html = await renderShell();
    expect(html).toMatch(/<a(?=[^>]*href="\/escala")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain("Acesso restrito");
    expect(html).not.toContain('href="/conta"');
    expect(html).not.toContain('href="/admin/');
    expect(html).not.toContain("default-private-tenant");
    expect(state.module).not.toHaveBeenCalled();
  });
  it.each([{ status: "BLOCKED" as const, tenantId: "tenant-test" }, { status: "ACTIVE" as const, tenantId: undefined }])("shows the same restricted public link for a denied account: %j", async value => {
    state.session = { user: { id: "u1", name: "Conta", email: "user@example.test", role: "USER", ...value } };
    state.module.mockResolvedValue(nominalSession);
    const html = await renderShell();
    expect(html).toContain('href="/escala"');
    expect(html).toContain("Acesso restrito");
    if (value.status === "BLOCKED") expect(html).not.toContain('href="/conta"');
    expect(state.module).not.toHaveBeenCalled();
  });
  it("keeps public navigation independent of the nominal session store", async () => {
    state.module.mockRejectedValue(new Error("private internal failure"));
    const html = await renderShell();
    expect(html).toContain('href="/pdf"');
    expect(html).toContain('href="/escala"');
    expect(html).not.toContain("private internal failure");
    expect(state.module).not.toHaveBeenCalled();
  });
});
