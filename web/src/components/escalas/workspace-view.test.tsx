import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import { Rules } from "./configuration";
import { EscalasStatus } from "./escalas-workspace";
import { Proposals, Publication, ValidationResults } from "./results";
import { Roster } from "./roster";
import { newEmployee, newInput } from "./workspace-model";

function sample() {
  const input = newInput("2", "Centro", "2026-10", 42);
  input.employees = [
    {
      ...newEmployee(42, "turno-inicial"),
      id: "z",
      registration: "02",
      name: "Zélia",
      sector: "Reposição",
      role: "Repositor",
      activeFrom: "2020-01-01",
    },
    {
      ...newEmployee(42, "turno-inicial"),
      id: "a",
      registration: "01",
      name: "Ana",
      sector: "Reposição",
      role: "Repositor",
      activeFrom: "2020-01-01",
    },
  ];
  input.assignments = [{ employeeId: "a", date: input.startDate, kind: "OFF", locked: true }];
  const validation: EscalaValidation = {
    valid: true,
    readyToPublish: true,
    issues: [],
    summaries: [],
    minimumCoverageMargin: 1,
  };
  const workspace: EscalaWorkspace = {
    id: "plan",
    revision: 4,
    status: "DRAFT",
    input,
    validation,
    canEdit: true,
    canPublish: true,
    updatedAt: "2026-10-26T00:00:00Z",
  };
  return { input, validation, workspace };
}

describe("Escalas practical accessibility and publication states", () => {
  it("renders the week by sector/cargo/name, with explicit pending and locked day states", () => {
    const { input } = sample();
    const html = renderToStaticMarkup(
      <Roster
        input={input}
        validation={null}
        disabled={false}
        canUnlock
        canSuggest={false}
        onChange={vi.fn()}
        onSuggest={vi.fn()}
      />,
    );
    expect(html).toContain("Reposição / Repositor");
    expect(html.indexOf('scope="row"') + html.slice(html.indexOf('scope="row"')).indexOf("Ana")).toBeLessThan(
      html.lastIndexOf("Zélia"),
    );
    expect(html).toContain("Pendente");
    expect(html).toContain("Bloqueado");
    expect(html).toContain("rolagem horizontal");
    expect(html).toContain('aria-label="Ana, 28/09/2026: Folga, bloqueado. Editar"');
    expect(html).toContain("Sugestões só ficam disponíveis após salvar a revisão");
  });

  it("keeps individual reconciliation collapsed and identifies unsaved validation", () => {
    const { input, validation } = sample();
    const pending = renderToStaticMarkup(<ValidationResults input={input} validation={null} />);
    expect(pending).toContain("Os dados foram alterados");
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} />);
    expect(html).toContain("Conferência por colaborador (opcional)");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it.each([
    { dirty: true, canPublish: true, ready: true },
    { dirty: false, canPublish: false, ready: true },
    { dirty: false, canPublish: true, ready: false },
  ])("requires current saved validation and approval permission: %j", ({ dirty, canPublish, ready }) => {
    const { workspace, validation } = sample();
    const html = renderToStaticMarkup(
      <Publication
        workspace={{ ...workspace, canPublish }}
        validation={{ ...validation, readyToPublish: ready }}
        dirty={dirty}
        busy={false}
        onPublish={vi.fn()}
      />,
    );
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publicar revisão conferida/);
    if (dirty) expect(html).not.toContain("/api/escalas/export");
  });

  it("exports the exact saved revision with separate PDF and XLSX controls", () => {
    const { workspace, validation } = sample();
    const html = renderToStaticMarkup(
      <Publication workspace={workspace} validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />,
    );
    expect(html).toContain("revision=4&amp;format=pdf");
    expect(html).toContain("revision=4&amp;format=xlsx");
    expect(html).toContain("Não há envio a colaboradores");
  });

  it("shows full-plan preview changes and never applies an invalid solver result", () => {
    const { input, validation } = sample();
    const proposal = {
      ...input,
      assignments: [...input.assignments, { employeeId: "z", date: input.startDate, kind: "OFF" as const }],
    };
    const html = renderToStaticMarkup(
      <Proposals
        input={input}
        generated={{
          result: { status: "FEASIBLE", message: "Viável" },
          proposalInput: proposal,
          validation: { ...validation, valid: false },
        }}
        suggestions={[]}
        disabled={false}
        onGenerated={vi.fn()}
        onSuggestion={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain("Nada foi gravado");
    expect(html).toContain("1 dias de 1 colaboradores");
    expect(html).toContain("Zélia");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aplicar proposta à grade/);
  });

  it("does not offer a checkbox that purports to certify night-hour accounting", () => {
    const { input } = sample();
    const html = renderToStaticMarkup(<Rules input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("cômputo específico da hora noturna");
    expect(html).not.toContain("Regras específicas do trabalho noturno foram conferidas");
  });

  it("offers cancellation for analysis but never for an in-progress write", () => {
    const analysis = renderToStaticMarkup(
      <EscalasStatus busy="Gerando proposta…" notice="" cancellable onCancel={vi.fn()} />,
    );
    expect(analysis).toContain("Cancelar análise");
    const write = renderToStaticMarkup(
      <EscalasStatus busy="Salvando revisão…" notice="" cancellable={false} onCancel={vi.fn()} />,
    );
    expect(write).not.toContain("Cancelar análise");
    expect(write).toContain('role="status"');
  });
});
