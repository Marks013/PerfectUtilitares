import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { newEmployee, newInput } from "./workspace-model";
import { CoverageTimeline } from "./coverage-timeline";

it("keeps exact time and count labels outside the scaled SVG on narrow screens", () => {
  const input = newInput("01", "Filial", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, "clock"), id: "person", registration: "1", name: "Pessoa", role: "Repositor", sector: "Loja" }];
  input.shifts = [{ id: "clock", name: "Exato", segments: [{ start: 576, end: 840, kind: "WORK" }, { start: 840, end: 960, kind: "BREAK" }, { start: 960, end: 1200, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "person", date: "2026-11-01", kind: "WORK", shiftId: "clock" }];
  const html = renderToStaticMarkup(<CoverageTimeline input={input} />);
  expect(html).toContain('preserveAspectRatio="none"');
  expect(html).toContain("Pessoas: 0–1");
  expect(html).toContain("09:36"); expect(html).toContain("20:00");
  const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>") + 6);
  expect(svg).not.toContain("<text");
  expect(html).toContain("Faixa de horário e colaboradores");
  expect(html).toContain("Entradas ou retornos");
});
