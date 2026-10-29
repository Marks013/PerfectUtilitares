import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProcessingBar, WorkspaceFeedback } from "./workspace-feedback";

describe("honest accessible processing feedback", () => {
  it("exposes an indeterminate progress bar without a fabricated percentage", () => {
    const html = renderToStaticMarkup(<ProcessingBar label="Gerando proposta" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Gerando proposta"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("%");
  });
  it("does not announce success while an operation is still processing", () => {
    const html = renderToStaticMarkup(<WorkspaceFeedback busy="Salvando revisão…" notice="Concluído" error="" onAction={vi.fn()} />);
    expect(html).toContain("Salvando revisão…");
    expect(html).not.toContain("Concluído");
  });
  it("renders explanation and an explicit recovery action without duplicate alerts", () => {
    const html = renderToStaticMarkup(<WorkspaceFeedback busy="" error="Atualizado em outra aba" notice="" problem={{ message: "Atualizado em outra aba", explanation: "Reabra após confirmar suas alterações.", tone: "error", action: "reload", actionLabel: "Conferir revisão atual" }} onAction={vi.fn()} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Conferir revisão atual");
    expect(html).toContain("Reabra após confirmar");
    expect(html.match(/Atualizado em outra aba/g)).toHaveLength(1);
  });
  it("keeps the current draft open when authentication must be renewed", () => {
    const html = renderToStaticMarkup(<WorkspaceFeedback busy="" error="Sessão encerrada" notice="" problem={{ message: "Sessão encerrada", explanation: "Entre novamente em outra aba.", tone: "error", action: "login", actionLabel: "Entrar novamente" }} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("/login?callbackUrl=%2Fescalas");
  });
});
