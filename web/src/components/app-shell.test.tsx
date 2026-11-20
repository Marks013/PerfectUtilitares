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

vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: state.module }));
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
    expect(html).not.toContain('href="/escala"');
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
  it("shows only the module link for a verified shared session, without account or administrative privileges", async () => {
    state.module.mockResolvedValue({ id: "verified", tenantId: "default-private-tenant" });
    const html = await renderShell();
    expect(html).toMatch(/<a(?=[^>]*href="\/escala")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).not.toContain('href="/conta"'); expect(html).not.toContain('href="/admin/'); expect(html).not.toContain("default-private-tenant");
  });
  it.each([{ status: "BLOCKED" as const, tenantId: "tenant-test" }, { status: "ACTIVE" as const, tenantId: undefined }])("does not fall back to shared access for a denied account: %j", value => {
    state.session = { user: { id: "u1", name: "Conta", email: "user@example.test", role: "USER", ...value } };
    state.module.mockResolvedValue({ id: "verified", tenantId: "default-private-tenant" });
    return renderShell().then(html => { expect(html).not.toContain('href="/escala"'); expect(state.module).not.toHaveBeenCalled(); });
  });
  it("keeps public navigation available without exposing the protected module on a session-store failure", async () => {
    state.module.mockRejectedValue(new Error("private internal failure"));
    const html = await renderShell(); expect(html).toContain('href="/pdf"'); expect(html).not.toContain('href="/escala"'); expect(html).not.toContain("private internal failure");
  });
});
