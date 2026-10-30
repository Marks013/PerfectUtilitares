import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContinuousWorkOption } from "./hours-proposal";
import { newInput } from "./workspace-model";

describe("optional continuous-work limit", () => {
  it("starts checked for an older plan without the field and can display an explicit opt-out", () => {
    const input = newInput("07", "Hiper", "2026-11", 42);
    delete input.policy.limitContinuousWorkBlocks;
    const render = () => renderToStaticMarkup(<ContinuousWorkOption input={input} disabled={false} onChange={vi.fn()} />);
    expect(render()).toContain("Limitar cada bloco a 4h30");
    expect(render()).toContain('checked=""');
    input.policy.limitContinuousWorkBlocks = false;
    expect(render()).not.toContain('checked=""');
    expect(render()).toContain("sem mudar a jornada semanal nem a duração do intervalo");
  });

  it("warns only for a locked long block, never claiming that its clock was changed", () => {
    const input = newInput("08", "Tiradentes", "2026-11", 42);
    input.shifts = [{ id: "long", name: "Original", segments: [{ start: 420, end: 750, kind: "WORK" }, { start: 750, end: 870, kind: "BREAK" }, { start: 870, end: 1044, kind: "WORK" }] }];
    input.assignments = [{ employeeId: "p", date: "2026-11-02", kind: "WORK", shiftId: "long", locked: true }];
    const before = JSON.stringify(input);
    const render = () => renderToStaticMarkup(<ContinuousWorkOption input={input} disabled={false} onChange={vi.fn()} />);
    expect(render()).toContain("Este horário está bloqueado e foi mantido");
    expect(JSON.stringify(input)).toBe(before);
    input.assignments[0].locked = false;
    expect(render()).not.toContain("Este horário está bloqueado");
    input.assignments[0].locked = true;
    input.policy.limitContinuousWorkBlocks = false;
    expect(render()).not.toContain("Este horário está bloqueado");
  });

  it("disables the checkbox during a protected or processing state", () => {
    const html = renderToStaticMarkup(<ContinuousWorkOption input={newInput("11", "Castelo", "2026-11", 42)} disabled onChange={vi.fn()} />);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
  });
});
