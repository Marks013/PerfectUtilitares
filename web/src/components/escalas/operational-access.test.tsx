import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EscalaAccessBoundary } from "./operational-access";

function render(initialAccess: "ACCOUNT" | "MODULE" | null) {
  return renderToStaticMarkup(<EscalaAccessBoundary initialAccess={initialAccess}>
    <button type="button">Área de planejamento privada</button>
  </EscalaAccessBoundary>);
}

describe("accessible Escalas operational access", () => {
  it("describes the optional dedicated credential without assuming a Unimed password", () => {
    const html = render(null);
    expect(html).toContain("Acesso ao planejamento de escalas");
    expect(html).toContain("Quando não houver senha própria configurada");
    expect(html).toContain("a senha operacional padrão do Unimed continua válida");
    expect(html).not.toContain("Use a senha operacional padrão do Unimed para planejar");
    expect(html).not.toContain("Área de planejamento privada");
  });

  it("associates the password field with instructions and a visible label", () => {
    const html = render(null);
    expect(html).toMatch(/<label[^>]*for="escala-access-password"[^>]*>Senha operacional<\/label>/);
    expect(html).toContain('id="escala-access-description"');
    expect(html).toMatch(/<input[^>]*id="escala-access-password"[^>]*type="password"/);
    expect(html).toContain("current-password");
    expect(html).toContain('aria-invalid="false"');
    expect(html).toContain('aria-describedby="escala-access-description"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Mostrar senha");
    expect(html).toContain('type="submit"');
    expect(html).toContain("Liberar planejamento");
  });

  it("does not introduce a module-password prompt for an authenticated account", () => {
    const html = render("ACCOUNT");
    expect(html).toContain("Área de planejamento privada");
    expect(html).not.toContain("Senha operacional");
    expect(html).not.toContain("Bloquear Escalas");
    expect(html).not.toContain('inert=""');
  });

  it("preserves the independent module lock control for an active module session", () => {
    const html = render("MODULE");
    expect(html).toContain("Acesso operacional compartilhado");
    expect(html).toContain("Bloquear Escalas");
    expect(html).toContain("Área de planejamento privada");
    expect(html).not.toContain('id="escala-access-password"');
  });
});
