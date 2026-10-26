import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | {
    user: { status: string; role: string; tenantId?: string };
  },
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
vi.mock("@/components/escalas/escalas-workspace", () => ({
  EscalasWorkspace: () => <p>Área privada de escalas</p>,
}));

import EscalasPage from "./page";

describe("Escalas private page", () => {
  beforeEach(() => {
    state.session = null;
  });
  it("redirects anonymous and blocked sessions to login", async () => {
    await expect(EscalasPage()).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fescalas");
    state.session = {
      user: { status: "BLOCKED", role: "ADMIN", tenantId: "tenant" },
    };
    await expect(EscalasPage()).rejects.toThrow("REDIRECT:/login");
  });
  it("does not mount the workspace for a user without a tenant", async () => {
    state.session = { user: { status: "ACTIVE", role: "ADMIN" } };
    const html = renderToStaticMarkup(await EscalasPage());
    expect(html).toContain("vinculada a uma empresa");
    expect(html).not.toContain("Área privada de escalas");
  });
  it.each(["ADMIN", "OPERATOR"])(
    "mounts the authenticated tenant UI for %s while APIs enforce branch permissions",
    async (role) => {
      state.session = { user: { status: "ACTIVE", role, tenantId: "tenant" } };
      expect(renderToStaticMarkup(await EscalasPage())).toContain("Área privada de escalas");
    },
  );
});
