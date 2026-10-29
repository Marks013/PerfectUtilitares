import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Coverage, ImportEmployees } from "./coverage-import";
import { newInput } from "./workspace-model";

function fixture() {
  const input = newInput("02", "Filial de teste", "2026-11", 42);
  input.employees = [{ id: "p", registration: "001", name: "Pessoa", sector: "Loja", role: "Repositor", weeklyHours: 42, shiftIds: [], activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }];
  return input;
}

describe("automatic coverage screen", () => {
  it("makes automatic sizing the default and keeps operational overrides optional", () => {
    const html = renderToStaticMarkup(<Coverage input={fixture()} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("Cobertura automática por setor");
    expect(html).toContain("definidas ao gerar a proposta");
    expect(html).toContain("Repositor");
    expect(html).toContain("Mínimos obrigatórios (opcional)");
    expect(html).not.toContain("Sugerir cobertura pela equipe");
    expect(html).not.toContain("Conferi a cobertura sugerida");
    expect(html).not.toContain("<details open");
  });

  it("distinguishes a provisional target from an explicit required minimum", () => {
    const input = fixture();
    input.demands = [
      { id: "soft", date: input.startDate, sector: "Loja", role: "Repositor", start: 480, end: 720, minimum: 1, estimated: true },
      { id: "hard", date: input.startDate, sector: "Loja", start: 780, end: 1020, minimum: 2 },
    ];
    const html = renderToStaticMarkup(<Coverage input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("meta automática");
    expect(html).toContain("mínimo obrigatório");
    expect(html).toContain("1 faixa(s) marcada(s) como mínimo obrigatório");
    expect(html).toContain("Voltar à cobertura automática");
    expect(html).not.toContain("Confirmar uso de cobertura automática");
  });

  it("shows a truthful initial import status without invented progress", () => {
    const html = renderToStaticMarkup(<ImportEmployees input={fixture()} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Selecione o arquivo para conferir a equipe");
    expect(html).not.toContain("100%");
  });
});
