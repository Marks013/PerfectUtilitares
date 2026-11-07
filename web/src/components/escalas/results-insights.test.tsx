import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EscalaValidation } from "@/lib/escalas/types";
import { ValidationResults } from "./results";
import { newEmployee, newInput } from "./workspace-model";

function fixture() {
  const input = newInput("02", "Centro", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", sector: "Reposição", role: "Repositor", activeFrom: "2020-01-01" }];
  const validation: EscalaValidation = { valid: true, readyToPublish: false, minimumCoverageMargin: null, issues: [], summaries: [{ employeeId: "person", workedMinutes: 0, workDays: 2, offDays: 1, maxStreak: 1, sundaysWorked: 99 }] };
  return { input, validation };
}
describe("operational review insights", () => {
  it("shows days without timed presence even when estimated demand is zero", () => {
    const { input, validation } = fixture();
    input.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: input.shifts[0].id }, { employeeId: "person", date: "2026-11-03", kind: "OFF" }];
    input.demands = [{ id: "estimate", sector: "Reposição", date: "2026-11-03", start: 480, end: 1080, minimum: 0, estimated: true }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Dias sem ninguém com horário no setor");
    expect(html).toContain("Uma estimativa zero não confirma fechamento nem atendimento");
    expect(html).toContain("Consultar datas de Reposição");
    expect(html).toContain("03/11");
    expect(html).not.toContain("Desfalques (0)");
  });
  it("shows monthly Sunday rest against known availability, not technical-horizon totals", () => {
    const { input, validation } = fixture();
    input.assignments = [
      { employeeId: "person", date: "2026-11-01", kind: "WORK", shiftId: input.shifts[0].id },
      { employeeId: "person", date: "2026-11-08", kind: "OFF" },
      { employeeId: "person", date: "2026-11-15", kind: "ABSENCE" },
      { employeeId: "person", date: "2026-11-22", kind: "WORK", shiftId: input.shifts[0].id },
      { employeeId: "person", date: "2026-12-06", kind: "OFF" },
    ];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="information" />);
    expect(html).toContain("Domingos no mês");
    expect(html).toContain("1 folga(s) / 3 disponíveis");
    expect(html).toContain("2 trabalhado(s) · 1 afastado(s) · 1 sem definição");
    expect(html).not.toContain(">99<");
  });
});
