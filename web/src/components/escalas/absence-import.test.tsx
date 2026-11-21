import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "./access-context";
import { AbsenceImport, absencePeriods } from "./absence-import";

describe("persisted absence replacement entry", () => {
  it("explains removals, medical privacy and interval without claiming vacations or local apply", () => {
    const workspace = { id: "plan", revision: 4, input: { branchCode: "07", branchName: "Centro", startDate: "2026-11-30", endDate: "2027-01-03", employees: [] } } as unknown as EscalaWorkspace;
    const html = renderToStaticMarkup(<EscalaAccessProvider value={{ channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] }}><AbsenceImport workspace={workspace} disabled={false} replaceImport={vi.fn()} /></EscalaAccessProvider>);
    expect(html).toContain("Importar e substituir afastamentos"); expect(html).toContain("não importa dados médicos");
    expect(html).toContain("ficarão sem atribuição"); expect(html).toContain("Substituir afastamentos a partir de");
    expect(html).not.toContain("Aplicar afastamentos à proposta"); expect(html).not.toContain("Importar afastamentos e férias");
  });
  it("preserves adjacent-day grouping utility without mutating input", () => {
    const days = [{ employeeId: "p", date: "2026-12-02", kind: "ABSENCE" as const }, { employeeId: "p", date: "2026-12-01", kind: "ABSENCE" as const }];
    expect(absencePeriods(days)).toEqual([{ employeeId: "p", startDate: "2026-12-01", endDate: "2026-12-02" }]);
    expect(days[0].date).toBe("2026-12-02");
  });
});
