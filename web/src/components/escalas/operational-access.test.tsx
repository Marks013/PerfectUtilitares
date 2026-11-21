import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { EscalaAccessBoundary } from "./operational-access";

function render(initialAccess: "ACCOUNT" | "MODULE" | null, initialContext?: EscalaClientAccess) {
  return renderToStaticMarkup(<EscalaAccessBoundary initialAccess={initialAccess} initialContext={initialContext} initialExpiresAt={initialContext?.expiresAt}>
    <button type="button">Área de planejamento privada</button>
  </EscalaAccessBoundary>);
}

describe("accessible Escalas operational access", () => {
  it("describes the nominal access, without treating it as identity or a shared password", () => {
    const html = render(null);
    expect(html).toContain("Acesso ao planejamento de escalas");
    expect(html).toContain("Informe o nome cadastrado pelo administrador");
    expect(html).toContain("não comprova identidade pessoal");
    expect(html).not.toContain("Senha operacional");
    expect(html).not.toContain("Unimed");
    expect(html).not.toContain("Área de planejamento privada");
  });

  it("associates the name field with instructions and a visible label", () => {
    const html = render(null);
    expect(html).toMatch(/<label[^>]*for="escala-access-username"[^>]*>Nome cadastrado<\/label>/);
    expect(html).toContain('id="escala-access-help"');
    expect(html).toMatch(/<input[^>]*id="escala-access-username"[^>]*autocomplete="username"/i);
    expect(html).toContain('aria-invalid="false"');
    expect(html).toContain('aria-describedby="escala-access-help"');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("Liberar planejamento");
  });

  it("does not introduce a nominal prompt for an authenticated account", () => {
    const html = render("ACCOUNT", { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] });
    expect(html).toContain("Área de planejamento privada");
    expect(html).not.toContain("Nome cadastrado");
    expect(html).not.toContain("Bloquear Escalas");
    expect(html).not.toContain('inert=""');
  });

  it("preserves the independent lock control for a verified nominal session", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const html = render("MODULE", { channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
      branches: [{ code: "02", label: "Filial 02", capabilities: ["workspace.read"] }], expiresAt });
    expect(html).toContain("somente filiais autorizadas");
    expect(html).toContain("Bloquear Escalas");
    expect(html).toContain("Área de planejamento privada");
    expect(html).not.toContain('id="escala-access-username"');
  });

  it.each([["ACCOUNT", "Confira o acesso da sua conta"], ["MODULE", "Nome cadastrado"]] as const)(
    "fails closed on incomplete %s access before rendering private content", (channel, message) => {
      const html = render(channel);
      expect(html).toContain(message);
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("Área de planejamento privada");
      expect(html).not.toContain("Bloquear Escalas");
    },
  );
});
