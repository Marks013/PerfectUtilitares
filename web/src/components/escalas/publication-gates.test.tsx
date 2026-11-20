import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { Publication } from "./publication";
import { newEmployee, newInput } from "./workspace-model";

function fixture(): EscalaWorkspace {
  const input = newInput("08", "Filial sintética", "2026-11", 42);
  input.shifts = [{ id: "clock", name: "Turno sintético", segments: [
    { kind: "WORK", start: 480, end: 720 },
    { kind: "BREAK", start: 720, end: 780 },
    { kind: "WORK", start: 780, end: 1044 },
  ] }];
  input.employees = [{ ...newEmployee(42, "clock"), id: "p", name: "Pessoa sintética",
    registration: "0001", sector: "Setor A", role: "Operador", activeFrom: "2024-01-01" }];
  input.assignments = [{ employeeId: "p", date: "2026-11-04", kind: "WORK", shiftId: "clock" }];
  const validation = {
    valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null,
  };
  return { id: "synthetic", revision: 4, status: "DRAFT", canEdit: true, canPublish: true,
    updatedAt: "2026-11-20T00:00:00.000Z", input, validation };
}

function render(options: { workspace?: EscalaWorkspace; dirty?: boolean; busy?: boolean; outdated?: boolean;
  candidatePending?: boolean; canUseCandidate?: boolean } = {}) {
  const workspace = options.workspace ?? fixture();
  return renderToStaticMarkup(<Publication workspace={workspace} validation={workspace.validation}
    dirty={options.dirty ?? false} busy={options.busy ?? false} outdated={options.outdated ?? false}
    onPublish={vi.fn()} candidatePending={options.candidatePending}
    canUseCandidate={options.canUseCandidate} onUseCandidate={vi.fn()} />);
}

function approval(html: string) {
  const portion = html.split("Aprovação interna (opcional)")[1];
  expect(portion).toBeTruthy();
  return portion;
}

describe("internal publication UI preserves permissions and explicit review", () => {
  it("allows the approver to review but never publishes before explicit revision acknowledgement", () => {
    const area = approval(render());
    expect(area).toContain("Conferi esta revisão da filial 08");
    expect(area).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it("does not offer a usable publishing control to a viewer", () => {
    const workspace = fixture();
    workspace.canPublish = false;
    const area = approval(render({ workspace }));
    expect(area).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it.each([
    { dirty: true }, { busy: true }, { outdated: true },
  ])("blocks acknowledgement and publish while revision is not ready (%o)", state => {
    const area = approval(render(state));
    expect(area).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it("marks an already published revision as immutable for a second publication", () => {
    const workspace = fixture();
    workspace.status = "PUBLISHED";
    const area = approval(render({ workspace }));
    expect(area).toContain("Revisão já publicada");
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Revisão já publicada<\/button>/);
  });

  it("explains a pending candidate is not the saved roster being exported", () => {
    const html = render({ candidatePending: true, canUseCandidate: false });
    expect(html).toContain("Há uma proposta candidata ainda não aplicada");
    expect(html).toContain("PDF e XLSX abaixo usam a grade atual");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Usar proposta na grade<\/button>/);
  });

  it("does not present HOURS_ONLY references as a publishable daily roster", () => {
    const workspace = fixture();
    workspace.input.generationMode = "HOURS_ONLY";
    workspace.input.assignments = [];
    const html = render({ workspace });
    expect(html).toContain("Não representa presença diária nem cobertura garantida");
    expect(approval(html)).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
    expect(html).toContain("Referências de horários");
  });
});

describe("publication accessibility guidance", () => {
  it("associates the publish control with a human-readable revision acknowledgement", () => {
    const area = approval(render());
    expect(area).toContain('id="escala-publication-guidance"');
    expect(area).toContain('aria-describedby="escala-publication-guidance"');
    expect(area).toContain("Confira a revisão salva e marque a confirmação antes de publicar.");
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it.each([
    [{ dirty: true }, "Há alterações ainda não salvas."],
    [{ outdated: true }, "A grade está desatualizada."],
    [{ busy: true }, "Conclua a operação em andamento"],
  ])("explains why publication is blocked for %o", (options, message) => {
    const area = approval(render(options));
    expect(area).toContain(message);
    expect(area).toContain('aria-describedby="escala-publication-guidance"');
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it("distinguishes permission, validation and already-published revisions", () => {
    const viewer = fixture();
    viewer.canPublish = false;
    expect(approval(render({ workspace: viewer }))).toContain("não aprovar a publicação");
    const unready = fixture();
    unready.validation = { ...unready.validation!, readyToPublish: false };
    expect(approval(render({ workspace: unready }))).toContain("pendências da validação");
    const published = fixture();
    published.status = "PUBLISHED";
    expect(approval(render({ workspace: published }))).toContain("Esta revisão já foi publicada.");
  });

  it("does not present an empty roster or reference-only scenario as publishable", () => {
    const empty = fixture();
    empty.input.assignments = [];
    expect(approval(render({ workspace: empty }))).toContain("Gere e aplique uma grade");
    const reference = fixture();
    reference.input.generationMode = "HOURS_ONLY";
    reference.input.assignments = [];
    const area = approval(render({ workspace: reference }));
    expect(area).toContain("Referências de horários não representam uma escala diária");
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });

  it("preserves an explicit review requirement even when all validation gates are ready", () => {
    const area = approval(render());
    expect(area).toContain("Conferi esta revisão da filial 08");
    expect(area).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(area).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });
});
