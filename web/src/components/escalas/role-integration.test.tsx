import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { EscalaAccessProvider } from "./access-context";
import { EscalaAccessBoundary } from "./operational-access";
import { CreateApprovedPlan } from "./approved-forms";
import { OperatorAdministration } from "./operator-administration";
import { Field } from "./controls";
import { Shifts } from "./configuration";
import { newInput } from "./workspace-model";

const operator: EscalaClientAccess = { channel: "USERNAME", administrator: false, allBranches: false, roleLabel: "Filial", branches: [{ code: "07", label: "Centro", capabilities: ["workspace.read", "workspace.create", "shift.manage"] }] };
const administrator: EscalaClientAccess = { channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] };
const as = (access: EscalaClientAccess | null, node: React.ReactNode) => renderToStaticMarkup(<EscalaAccessProvider value={access}>{node}</EscalaAccessProvider>);

describe("operational roles and contextual controls", () => {
  it("offers registered name entry with an honest explanation instead of a shared password", () => {
    const html = renderToStaticMarkup(<EscalaAccessBoundary initialAccess={null}><p>Protected</p></EscalaAccessBoundary>);
    expect(html).toContain("Nome cadastrado");
    expect(html).toContain("não comprova identidade pessoal");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Protected");
  });
  it("offers only allowed branches and a blocked creation action until a real approval is selected", () => {
    const create = vi.fn(), html = as(operator, <CreateApprovedPlan disabled={false} create={create} />);
    expect(html).toContain("07 · Centro");
    expect(html).not.toContain("Código da filial");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Criar com esta equipe/);
    expect(create).not.toHaveBeenCalled();
  });
  it("reserves operator administration and free shift definitions to the administrative account", () => {
    expect(as(operator, <OperatorAdministration />)).toBe("");
    expect(as(null, <OperatorAdministration />)).toBe("");
    expect(as(administrator, <OperatorAdministration />)).toContain("Administrar operadores e filiais");
    const input = newInput("07", "Centro", "2026-12", 42);
    expect(as(operator, <Shifts input={input} disabled={false} onChange={vi.fn()} />)).not.toContain("Adicionar turno");
    expect(as(administrator, <Shifts input={input} disabled={false} onChange={vi.fn()} />)).toContain("Adicionar turno");
  });
  it("associates help with the field while preserving an existing error description", () => {
    const html = renderToStaticMarkup(<Field label="Horário" hint="Use HH:MM">{id => <input id={id} aria-describedby="clock-error" />}</Field>);
    const help = html.match(/<p id="([^"]+)"[^>]*>Use HH:MM/);
    expect(help).not.toBeNull();
    expect(html).toContain(`aria-describedby="clock-error ${help?.[1]}"`);
  });
});
