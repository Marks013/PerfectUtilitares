import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "../access-context";
import { newEmployee, newInput } from "../workspace-model";
import { ShiftSwap } from "./shift-swap";

const administrator: EscalaClientAccess = {
  channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [],
};
const operator: EscalaClientAccess = {
  channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
  branches: [{ code: "07", label: "Filial 07", capabilities: ["workspace.read", "workspace.save", "shift.manage"] }],
};

function render(access: EscalaClientAccess) {
  const input = newInput("07", "Filial 07", "2026-12", 42);
  const employee = {
    ...newEmployee(42, input.shifts[0].id), id: "employee", registration: "007", name: "Pessoa de teste",
    activeFrom: "2026-12-08", activeUntil: "2026-12-20",
  };
  const workspace: EscalaWorkspace = {
    id: "workspace", revision: 3, status: "DRAFT", updatedAt: "2026-11-23T10:00:00Z", canEdit: true, canPublish: true,
    input: { ...input, employees: [employee] },
    validation: { valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null },
  };
  return renderToStaticMarkup(<EscalaAccessProvider value={access}>
    <ShiftSwap workspace={workspace} employee={employee} disabled={false} onApplied={vi.fn()} onClose={vi.fn()} />
  </EscalaAccessProvider>);
}

describe("troca de turno por período", () => {
  it.each([administrator, operator])("mostra o período pronto pelos limites do vínculo e recolhe a edição de datas para $roleLabel", access => {
    const html = render(access);
    expect(html).toContain("08/12/2026 a 20/12/2026");
    expect(html).toMatch(/<details(?![^>]*\bopen=)[^>]*><summary[^>]*>Alterar datas<\/summary>/);
    expect(html).toContain('min="2026-12-08" max="2026-12-20"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Conferir troca de turno<\/button>/);
    expect(html).not.toContain("Consultar turnos permitidos novamente");
    expect(html).not.toContain("Salvar troca de turno");
  });

  it("não mostra o formulário a operador sem acesso à filial", () => {
    const [grant] = operator.branches;
    expect(render({ ...operator, branches: [{ ...grant, code: "08" }] })).toBe("");
  });
});
