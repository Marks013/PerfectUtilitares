import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaValidation, EscalaWorkspace } from "@/lib/escalas/types";
import { Rules } from "./configuration";
import { visibleDates } from "@/lib/escalas/dates";
import { DeletePlan } from "./delete-plan";
import { Employees, EmployeeEditor } from "./employees";
import { Coverage, ImportEmployees } from "./coverage-import";
import { LaborPolicyFields } from "./labor-policy-fields";
import { EscalasStatus } from "./escalas-workspace";
import { Proposals, Publication, ValidationResults } from "./results";
import { CellEditor, Roster } from "./roster";
import { newEmployee, newInput } from "./workspace-model";

function sample() {
  const input = newInput("2", "Centro", "2026-10", 42);
  input.employees = [
    {
      ...newEmployee(42, "turno-inicial"),
      id: "z",
      registration: "02",
      name: "Zélia",
      sundayRestRule: "CLT_386",
      sector: "Reposição",
      role: "Repositor",
      activeFrom: "2020-01-01",
    },
    {
      ...newEmployee(42, "turno-inicial"),
      id: "a",
      registration: "01",
      name: "Ana",
      sundayRestRule: "CLT_386",
      sector: "Reposição",
      role: "Repositor",
      activeFrom: "2020-01-01",
    },
  ];
  input.assignments = [{ employeeId: "a", date: visibleDates(input)[0], kind: "OFF", locked: true }];
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
  it("does not ask for a second weekly journey in special rules", () => {
    const { input } = sample();
    const html = renderToStaticMarkup(<Rules input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).not.toContain("Carga padrão para novos colaboradores");
    expect(html).toContain("Premissas da simulação");
  });

  it("blocks stale exports with a direct regeneration action instead of exporting a previous 44h result", () => {
    const { workspace, validation } = sample();
    const html = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} outdated onPublish={vi.fn()} onRegenerate={vi.fn()} />);
    expect(html).toContain("Cenário alterado");
    expect(html).toContain("Gerar proposta atualizada");
    expect(html).not.toContain("/api/escalas/export?");
  });
  it("includes untimed managers in the day-off rotation and renders DUTY without inventing credited hours", () => {
    const { input, validation } = sample();
    input.employees = [{ ...input.employees[0], scheduleMode: "UNTIMED", shiftIds: [], planningEnabled: true }];
    const employee = input.employees[0];
    input.assignments = [{ employeeId: employee.id, date: visibleDates(input)[0], kind: "DUTY" }];
    validation.summaries = [{ employeeId: employee.id, workedMinutes: 0, workDays: 5, offDays: 2, maxStreak: 5, sundaysWorked: 1 }];
    const html = renderToStaticMarkup(<Roster input={input} validation={validation} disabled={false}
      canUnlock onChange={vi.fn()} />);
    expect(html).toContain("Não subordinado a horário, conforme condição expressamente informada");
    expect(html).toContain("Sem horário fixo · horas não apuradas");
    expect(html).toContain("5 dias trabalhados · 2 folgas");
    expect(html).not.toContain("42h por semana");
    expect(html).not.toContain("Turno não encontrado");
    const result = renderToStaticMarkup(<ValidationResults input={input} validation={validation} />);
    expect(result).toContain("Horas não apuradas");
    expect(result).not.toContain('class="p-2 tabular-nums">00:00');
  });

  it("distinguishes missing clock information from confirmed untimed status without crediting fictitious hours", () => {
    const { input, validation } = sample();
    input.employees = [{ ...input.employees[0], scheduleMode: "MISSING", shiftIds: [] }];
    input.assignments = [{ employeeId: input.employees[0].id, date: visibleDates(input)[0], kind: "DUTY" }];
    const html = renderToStaticMarkup(<Roster input={input} validation={validation} disabled={false} canUnlock onChange={vi.fn()} />);
    expect(html).toContain("Horário não informado · horas não apuradas");
    expect(html).toContain("presença diária planejada sem horário informado");
    expect(html).not.toContain("42h por semana");
    const editor = renderToStaticMarkup(<CellEditor employee={input.employees[0]} date={visibleDates(input)[0]} input={input} canUnlock onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(editor).toContain("não confirma dispensa de controle de jornada");
    expect(editor).not.toContain("Turno autorizado");
  });

  it("identifies the exact planning and warns about irreversible deletion without deleting during rendering", () => {
    const { workspace } = sample();
    const onDelete = vi.fn();
    const html = renderToStaticMarkup(<DeletePlan workspace={workspace} dirty busy={false} onDelete={onDelete} />);
    expect(html).toContain("Filial 2 · Centro");
    expect(html).toContain("01/10/2026 a 31/10/2026");
    expect(html).toContain("revisão 4");
    expect(html).toContain("Não pode ser desfeita");
    expect(html).toContain("alterações locais ainda não salvas");
    expect(html).toContain("Manter planejamento");
    expect(onDelete).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<DeletePlan workspace={{ ...workspace, canEdit: false }} dirty={false} busy={false} onDelete={onDelete} />)).toBe("");
  });

  it("offers DUTY only for untimed day editing and keeps timed shift controls for timed employees", () => {
    const { input } = sample();
    const renderEditor = (untimed: boolean) => renderToStaticMarkup(<CellEditor
      employee={{ ...input.employees[0], ...(untimed ? { scheduleMode: "UNTIMED" as const, shiftIds: [] } : {}) }}
      date={input.startDate} input={input} canUnlock onApply={vi.fn()} onCancel={vi.fn()} />);
    const untimed = renderEditor(true);
    expect(untimed).toContain('value="DUTY" selected=""');
    expect(untimed).toContain("ENC — Não subordinado a horário");
    expect(untimed).not.toContain('value="WORK"');
    expect(untimed).not.toContain("Turno autorizado");
    const timed = renderEditor(false);
    expect(timed).not.toContain('value="DUTY"');
    expect(timed).toContain("Turno autorizado");
  });

  it("makes timed shifts optional for untimed employee registration and preserves optional admission", () => {
    const { input } = sample();
    const employee = { ...input.employees[0], activeFrom: "", scheduleMode: "UNTIMED" as const, shiftIds: [] };
    const html = renderToStaticMarkup(<EmployeeEditor employee={employee} input={input} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("Sem horário fixo");
    expect(html).toContain("Incluído no rodízio 5×2");
    expect(html).toContain('value="DUTY"');
    expect(html).not.toContain("Turnos autorizados");
    expect(html).toContain("Data real de admissão (opcional)");
    expect(html).not.toMatch(/<input[^>]*required[^>]*type="date"/);
  });

  it("offers one-file FPRE136 import and optional bulk configuration without classifying people by sex", () => {
    const { input } = sample();
    input.employees[0].sundayRestRule = "UNREVIEWED";
    input.employees[0].planningEnabled = false;
    input.employees[0].sourceSchedule = {
      report: "FPRE136", code: "0000", description: "Não subordinado a horário",
      weekday: "00:00", saturday: "00:00",
    };
    const team = renderToStaticMarkup(<Employees input={input} disabled={false} onChange={vi.fn()} />);
    expect(team).toContain("Configurar equipe em lote");
    expect(team).toContain("Aplicar configuração à equipe");
    expect(team).toContain("Admissão e histórico são opcionais");
    expect(team).toContain("fora do planejamento");
    expect(team).toContain("Referência FPRE136");
    expect(team).not.toContain("enquadramento pendente");
    const upload = renderToStaticMarkup(<ImportEmployees input={input} disabled={false} onChange={vi.fn()} />);
    expect(upload).toContain("FPRE136 em CSV (recomendado) ou XLSX");
    expect(upload).toContain("Não é necessário outro arquivo");
    expect(upload).toContain("Baixar modelo CSV alternativo");
  });

  it("offers automatic coverage without a mandatory administrative review or a fictitious daily staffing floor", () => {
    const { input } = sample();
    input.policy.coverageReview = "SUGGESTED";
    const html = renderToStaticMarkup(<Coverage input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("Cobertura automática por setor");
    expect(html).toContain("Mínimos obrigatórios (opcional)");
    expect(html).toContain("não uma garantia de atendimento");
    expect(html).not.toContain("Conferi a cobertura sugerida");
    expect(html).not.toContain("referência é de pelo menos uma pessoa");
  });

  it("separates nonblocking verification limits from conflicts and discloses publication scope", () => {
    const { input, validation, workspace } = sample();
    validation.issues = [{ severity: "WARNING", code: "HISTORY_UNKNOWN", employeeId: "a", message: "Histórico anterior não verificado." }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} />);
    expect(html).toContain("Informações e limites de conferência (1)");
    expect(html).toContain("0 impedimento(s)");
    expect(html).toContain("0 ponto(s) para revisar");
    expect(html).toContain("Histórico anterior não verificado.");
    expect(html).not.toContain("Ana: Histórico anterior não verificado.");
    expect(html).not.toContain("HISTORY_UNKNOWN");
    expect(html).not.toContain("Referência técnica:");
    expect(html).not.toContain("Pendente ·");
    const publication = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    expect(publication).toContain("Publicar proposta");
    expect(publication).toContain("não certifica");
  });

  it("renders only the civil month by sector and name with pending and locked states", () => {
    const { input } = sample();
    const html = renderToStaticMarkup(
      <Roster
        input={input}
        validation={null}
        disabled={false}
        canUnlock
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("Reposição");
    expect(html).toContain("Organização: setor e nome A–Z");
    expect(html).not.toContain("Reposição / Repositor");
    expect((html.match(/scope="col"/g) ?? [])).toHaveLength(36);
    expect(html.indexOf('scope="row"') + html.slice(html.indexOf('scope="row"')).indexOf("Ana")).toBeLessThan(
      html.lastIndexOf("Zélia"),
    );
    expect(html).toContain("Dia não processado");
    expect(html).toContain(", bloqueado. Editar");
    expect(html).toContain("rolagem horizontal");
    expect(html).toContain('aria-label="Ana, 01/10/2026: Folga, bloqueado. Editar"');
    expect(html).toContain("As sugestões em massa consideram todos os colaboradores incluídos da filial");
    expect(html).not.toContain("Sugerir folgas");
  });

  it("keeps individual reconciliation collapsed and identifies unsaved validation", () => {
    const { input, validation } = sample();
    const pending = renderToStaticMarkup(<ValidationResults input={input} validation={null} />);
    expect(pending).toContain("Os dados foram alterados");
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} />);
    expect(html).toContain("Conferência por colaborador (opcional)");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("shows explicit continuity reservations in canonical sector/cargo/name order, initially collapsed", () => {
    const { input, validation } = sample();
    input.employees.push({
      ...newEmployee(42, "turno-inicial"),
      id: "b",
      registration: "03",
      name: "Bruno",
      sector: "Açougue",
      role: "Açougueiro",
      activeFrom: "2020-01-01",
    });
    const html = renderToStaticMarkup(
      <ValidationResults
        input={input}
        validation={{
          ...validation,
          boundaryReservations: [
            { employeeId: "z", date: "2026-11-02", kind: "OFF" },
            { employeeId: "a", date: "2026-11-02", kind: "OFF" },
            { employeeId: "b", date: "2026-11-02", kind: "OFF" },
          ],
        }}
      />,
    );
    expect(html).toContain("Folgas fixas reservadas para continuidade");
    expect(html).toContain("precisam ser mantidas na próxima escala");
    expect(html).toContain("não são dias publicados dentro deste horizonte");
    expect(html).toContain("Folga fixa reservada: 02/11/2026");
    expect(html.indexOf("Bruno")).toBeLessThan(html.indexOf("Ana"));
    expect(html.indexOf("Ana")).toBeLessThan(html.indexOf("Zélia"));
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("does not show a reservation panel when the optional field is absent or empty", () => {
    const { input, validation } = sample();
    const withoutField = renderToStaticMarkup(<ValidationResults input={input} validation={validation} />);
    const empty = renderToStaticMarkup(
      <ValidationResults input={input} validation={{ ...validation, boundaryReservations: [] }} />,
    );
    expect(withoutField).not.toContain("Folgas fixas reservadas para continuidade");
    expect(empty).not.toContain("Folgas fixas reservadas para continuidade");
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta/);
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
        disabled={false}
        onGenerated={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain("A sugestão ainda não foi aplicada");
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

  it("explains dated weekly ceilings and leaves collective authorization unconfirmed", () => {
    const input = newInput("2", "Centro", "2027-12", 42);
    const html = renderToStaticMarkup(<Rules input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("De 16/12/2026 a 15/12/2027");
    expect(html).toContain("Desde 16/12/2027");
    expect(html).toContain("13/12/2027 a 19/12/2027");
    expect(html).toContain("Adotar carga menor em toda a semana de transição");
    expect(html).toContain("Identificação e cláusula do instrumento coletivo");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("keeps the transition confirmation out of periods without a legal boundary", () => {
    const { input } = sample();
    const html = renderToStaticMarkup(<LaborPolicyFields input={input} onChange={vi.fn()} />);
    expect(html).not.toContain("Adotar carga menor em toda a semana de transição");
    expect(html).not.toContain("Identificação da certidão");
  });

  it("shows the CCT safeguards and separate certificate scopes without inventing an authorization", () => {
    const { input } = sample();
    input.policy.normativeProfile = "SINDECOMU_SUPERMARKETS_2026_2027";
    const html = renderToStaticMarkup(<LaborPolicyFields input={input} onChange={vi.fn()} />);
    expect(html).toContain("PR003084/2026");
    expect(html).toContain("não afasta o descanso dominical quinzenal das mulheres");
    expect(html).toContain("não significa fechamento automático de toda atividade interna");
    expect(html).toContain("A CCT homologada não é a certidão individual da empresa");
    expect(html).toContain("Certidão autoriza domingos");
    expect(html).toContain("Certidão autoriza feriados");
    expect(html).toContain("Certidão autoriza prorrogação e trabalho noturno após 20h");
    expect(html).not.toMatch(/<input[^>]*checked/);
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
