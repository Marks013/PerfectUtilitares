import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalasWorkspace } from "./escalas-workspace";
import { Publication } from "./publication";
import { changeGenerationMode, newEmployee, newInput } from "./workspace-model";

const mocked = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("./use-escalas-workspace", () => ({ useEscalasWorkspace: mocked.model }));

const validation = { valid: true, readyToPublish: true, summaries: [], issues: [], minimumCoverageMargin: null };

describe("workspace mode composition", () => {
  it.each(["DAYS_AND_HOURS", "REST_ONLY", "HOURS_ONLY"] as const)("renders relevant controls for %s at 42h", mode => {
    const original = newInput("11", "Loja", "2026-11", 42);
    original.generationMode = mode === "DAYS_AND_HOURS" ? "REST_ONLY" : "DAYS_AND_HOURS";
    original.shifts = [{ id: "shift", name: "Referência", segments: [{ start: 480, end: 984, kind: "WORK" }] }];
    original.employees = [{ ...newEmployee(42, "shift"), id: "person", registration: "test", name: "Pessoa teste", sector: "Setor", activeFrom: "2020-01-01" }];
    original.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "ABSENCE", locked: true }];
    const input = changeGenerationMode(original, mode);
    expect(input.needsRegeneration).toBe(true);
    expect(input.assignments).toEqual(original.assignments);
    expect(input.employees).toEqual(original.employees);
    expect(input.shifts).toEqual(original.shifts);
    expect(input.policy).toEqual(original.policy);
    const workspace: EscalaWorkspace = { id: "plan", revision: 1, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-11-12", input, validation };
    mocked.model.mockReturnValue({ input, workspace, workspaces: [], canCreate: false, canEdit: true,
      busy: "", notice: "", error: "", dirty: false, localBackup: true, saveState: "saved", validation });
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).toMatch(new RegExp(`<input(?=[^>]*value="${mode}")(?=[^>]*checked="")[^>]*>`));
    expect(html).toContain("Jornada mista de 42h");
    if (mode === "REST_ONLY") expect(html).not.toContain("conferir ou ajustar manualmente");
    else expect(html).toContain("conferir ou ajustar manualmente");
    if (mode === "HOURS_ONLY") expect(html).not.toContain('>Cobertura</button>');
    else expect(html).toContain('>Cobertura</button>');
    const files = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    if (mode === "HOURS_ONLY") {
      expect(files).toContain('<option value="hours" selected="">Referências de horários</option>');
      expect(files).not.toContain('value="rest"');
      expect(files).not.toContain('value="both"');
      expect(files).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta/);
    } else {
      expect(files).toContain('value="rest"');
      expect(files).toContain('value="both"');
    }
    const stale = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} outdated onPublish={vi.fn()} />);
    expect(stale).toMatch(/<button[^>]*disabled=""[^>]*>Gerar PDF/);
  });
});
