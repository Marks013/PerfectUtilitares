import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
import { AppNavLink } from "./app-nav-link";

describe("canonical navigation state", () => {
  it.each(["/escala", "/escalas", "/escala/consulta"])("marks the module at %s and always links to its canonical entry", path => {
    state.path = path;
    const html = renderToStaticMarkup(<AppNavLink href="/escala">Escalas 5×2</AppNavLink>);
    expect(html).toContain('aria-current="page"'); expect(html).toContain('href="/escala"');
  });
  it.each([null, "/escala-outra", "/admin", "/fotos"])("does not mark an unrelated or unresolved path %s", path => {
    state.path = path;
    expect(renderToStaticMarkup(<AppNavLink href="/escala">Escalas</AppNavLink>)).not.toContain("aria-current");
  });
});
