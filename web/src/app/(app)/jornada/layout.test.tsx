import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { user: { role: "ADMIN" | "USER"; status: "ACTIVE" | "BLOCKED" } } }));
vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("next/navigation", () => ({ usePathname: () => "/jornada/validar" }));
import JornadaLayout from "./layout";

describe("Jornada navigation access", () => {
  it.each([
    [null, false],
    [{ user: { role: "USER", status: "ACTIVE" } }, false],
    [{ user: { role: "ADMIN", status: "BLOCKED" } }, false],
    [{ user: { role: "ADMIN", status: "ACTIVE" } }, true],
  ] as const)("preserves administrative tab visibility for %j", async (session, expectedAdmin) => {
    state.session = session;
    const html = renderToStaticMarkup(await JornadaLayout({ children: <h1>Validar jornada</h1> }));
    expect(html).toContain('href="/jornada/validar"');
    for (const path of ["regras", "codigos", "historico"]) {
      expect(html.includes(`href="/jornada/${path}"`)).toBe(expectedAdmin);
    }
    expect(html.indexOf("Ferramentas de Jornada")).toBeLessThan(html.indexOf("<h1>"));
  });
});
