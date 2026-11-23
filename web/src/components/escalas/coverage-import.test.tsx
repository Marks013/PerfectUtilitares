import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "./access-context";
import { ImportEmployees } from "./coverage-import";

describe("persisted employee replacement entry", () => {
  it("offers complete-horizon replacement without the old local merge action", () => {
    const workspace = { id: "plan", revision: 4, input: { branchCode: "07", branchName: "Centro", startDate: "2026-11-30", endDate: "2027-01-03", employees: [] } } as unknown as EscalaWorkspace;
    const html = renderToStaticMarkup(<EscalaAccessProvider value={{ channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] }}><ImportEmployees workspace={workspace} disabled={false} replaceImport={vi.fn()} /></EscalaAccessProvider>);
    expect(html).toContain("Importar e substituir equipe"); expect(html).toContain("30/11/2026 a 03/01/2027");
    expect(html).toContain("quem não estiver no arquivo poderá sair"); expect(html).not.toContain("Aplicar registros aceitos à proposta");
  });
});
