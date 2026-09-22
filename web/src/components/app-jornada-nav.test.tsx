import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/jornada/validar" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
import { JornadaNavTabs } from "./app-jornada-nav";

describe("JornadaNavTabs", () => {
  it.each(["validar", "regras", "codigos", "historico"])("marks only %s as the current route without a dropdown", (route) => {
    state.pathname = `/jornada/${route}`;
    const items = ["validar", "regras", "codigos", "historico"].map((slug) => ({ href: `/jornada/${slug}`, label: slug }));
    const html = renderToStaticMarkup(<JornadaNavTabs items={items} />);
    expect(html).toContain('aria-label="Ferramentas de Jornada"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<a[^>]*(?:aria-current="page"[^>]*href="/jornada/${route}"|href="/jornada/${route}"[^>]*aria-current="page")[^>]*>`));
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
  });
});
