import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
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

import { AppShell } from "./app-shell";

async function renderShell() {
  return renderToStaticMarkup(
    await AppShell({ children: <main>Conteúdo</main> }),
  );
}

describe("AppShell Jornada navigation", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("keeps the Jornada submenu collapsed and public options compatible", async () => {
    const html = await renderShell();

    expect(html).toContain("Validador de Jornada");
    expect(html).toContain("Manutenção de PDFs");
    expect(html).toContain('href="/reajuste-salarial"');
    expect(html).toContain('href="/jornada/validar"');
    expect(html).not.toContain("<details open");
    expect(html).not.toContain('href="/jornada/regras"');
    expect(html).not.toContain('href="/jornada/codigos"');
    expect(html).not.toContain('href="/jornada/historico"');
    expect(html).not.toContain('href="/admin/ferias"');
  });

  it("shows administrative Jornada options only to an active administrator", async () => {
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

    expect(html).toContain('href="/jornada/regras"');
    expect(html).toContain('href="/jornada/codigos"');
    expect(html).toContain('href="/jornada/historico"');
    expect(html).toContain('href="/admin/ferias"');
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
