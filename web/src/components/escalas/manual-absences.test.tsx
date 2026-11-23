import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { ManualAbsences } from "./manual-absences";

const workspace = { id: "plan", revision: 4, input: {
  startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
  employees: [{ id: "p", name: "Ana", registration: "10", activeFrom: "2026-12-01" }],
  assignments: [
    { employeeId: "p", date: "2026-11-30", kind: "ABSENCE" },
    { employeeId: "p", date: "2026-12-01", kind: "ABSENCE", absenceSource: "MANUAL" },
    { employeeId: "p", date: "2026-12-02", kind: "ABSENCE", absenceSource: "MANUAL" },
    { employeeId: "p", date: "2026-12-03", kind: "ABSENCE" },
    { employeeId: "p", date: "2026-12-04", kind: "ABSENCE", absenceSource: "MANUAL", locked: true },
  ],
} } as unknown as EscalaWorkspace;

describe("manual absence panel", () => {
  function render(administrator = false, disabled = false) {
    return renderToStaticMarkup(<ManualAbsences workspace={workspace} administrator={administrator} disabled={disabled} changeAbsence={vi.fn()} />);
  }

  it("labels date controls, limits the dates to the visible month and does not group imported or locked days into a manual selection", () => {
    const html = render();
    expect(html).toContain("Início do afastamento");
    expect(html).toContain("Fim do afastamento");
    expect(html).toContain('min="2026-12-01"');
    expect(html).toContain('max="2026-12-31"');
    expect(html).not.toContain("30/11/2026");
    expect(html).toContain('aria-label="Excluir afastamento de Ana, 01/12/2026 a 02/12/2026"');
    expect(html).not.toContain('aria-label="Excluir afastamento de Ana, 03/12/2026');
    expect(html).not.toContain('aria-label="Excluir afastamento de Ana, 04/12/2026');
    expect(html).toContain("<dialog");
    expect(html).toContain("Confirmar exclusão");
  });

  it("permits administrator deletion of unlocked imports and explains the import replacement boundary", () => {
    const html = render(true);
    expect(html).toContain('aria-label="Excluir afastamento de Ana, 03/12/2026');
    expect(html).not.toContain('aria-label="Excluir afastamento de Ana, 04/12/2026');
    expect(html).toContain("A importação confirmada substitui");
  });

  it("does not offer an active form or deletion while workspace actions are unavailable", () => {
    const html = render(false, true);
    expect(html).toContain("resolva as alterações pendentes");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Salvar afastamento/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Excluir afastamento de Ana/);
  });
});
