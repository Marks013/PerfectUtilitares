import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaCapability } from "@/lib/escalas/permissions";
import { EscalaAccessProvider } from "./access-context";
import { renderAsAdministrator } from "./access-test-support";
import { Employees } from "./employees";
import { newEmployee, newInput } from "./workspace-model";

function team() {
  const input = newInput("07", "Filial 07", "2026-12", 42);
  input.employees = [
    { ...newEmployee(42), id: "included", registration: "01", name: "Pessoa Incluída", sector: "Caixa" },
    { ...newEmployee(42), id: "excluded", registration: "02", name: "Pessoa Excluída", sector: "Caixa", planningEnabled: false },
  ];
  return input;
}

const management: EscalaCapability[] = ["workspace.read", "workspace.save", "employee.manage"];

function renderOperator(capabilities: EscalaCapability[], options: { branchCode?: string; remove?: boolean; disabled?: boolean } = {}) {
  return renderToStaticMarkup(<EscalaAccessProvider value={{ channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
    branches: [{ code: options.branchCode ?? "07", label: "Filial autorizada", capabilities }] }}>
    <Employees input={team()} disabled={options.disabled ?? false} onChange={vi.fn()}
      onRemoveEmployee={options.remove === false ? undefined : vi.fn(async () => true)} />
  </EscalaAccessProvider>);
}

describe("manual team removal actions", () => {
  it("offers removal for included and excluded employees within the authorized branch", () => {
    const html = renderOperator(management);
    expect(html).toMatch(/Remover\s*<span[^>]*> Pessoa Incluída da proposta/);
    expect(html).toMatch(/Remover da proposta<span[^>]*> Pessoa Excluída/);
  });

  it("keeps actions discoverable but disabled while the workspace is busy", () => {
    const html = renderOperator(management, { disabled: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Remover\s*<span[^>]*> Pessoa Incluída da proposta/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remover da proposta<span[^>]*> Pessoa Excluída/);
  });

  it.each(["workspace.save", "employee.manage"] as const)("hides both actions without %s", capability => {
    expect(renderOperator(management.filter(item => item !== capability))).not.toContain("Remover");
  });

  it("hides removal on other branches and when no operation is provided", () => {
    expect(renderOperator(management, { branchCode: "08" })).not.toContain("Remover");
    expect(renderOperator(management, { remove: false })).not.toContain("Remover");
  });

  it("preserves the administrative removal buttons for standalone consumers", () => {
    const html = renderAsAdministrator(<Employees input={team()} disabled={false} onChange={vi.fn()} />);
    expect(html).toMatch(/Remover\s*<span[^>]*> Pessoa Incluída da proposta/);
    expect(html).toMatch(/Remover da proposta<span[^>]*> Pessoa Excluída/);
  });
});
