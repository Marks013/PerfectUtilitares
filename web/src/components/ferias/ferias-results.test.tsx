import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeriasAnalysis, FeriasChoice } from "./ferias-contract";
import { FeriasResults } from "./ferias-results";

function fixture(): FeriasAnalysis {
  return {
    competency: "2026-09", revision: "test", pricePeriods: ["2026-08-01"], issues: [],
    sources: [
      { name: "Cadastro Unimed", ready: true, competency: "2026-09", fallback: false },
      { name: "Fatura e coparticipação", ready: true, competency: "2026-09", fallback: false },
      { name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false },
    ],
    rows: [{
      row: 4, name: "Colaborador", registration: "1234", branch: "MATRIZ", start: "2026-09-01", end: "2026-09-30",
      days: 30, highlight: false, unimedText: "", loanText: "", issues: [], warnings: [],
      holderId: "holder", loanIdentity: "loan",
      holderCandidates: [{ id: "holder", label: "Pessoa Unimed" }, { id: "other", label: "Outra pessoa" }],
      loanCandidates: [{ id: "loan", label: "Pessoa consignado" }],
    }],
    summary: { total: 1, unimed: 0, loans: 0, pending: 0, highlighted: 0 }, canExport: true,
  };
}
function render(analysis = fixture(), choices: FeriasChoice[] = []) {
  return renderToStaticMarkup(<FeriasResults analysis={analysis} choices={choices} busy={false} stale={false} onChoose={vi.fn()} />);
}

describe("Ferias results presentation", () => {
  it("shows server-resolved identities as selected without explicit overrides", () => {
    const html = render();
    expect(html).toContain('value="holder" selected=""');
    expect(html).toContain('value="loan" selected=""');
    expect(html.match(/Vínculo confirmado/g)).toHaveLength(2);
  });

  it("honors explicit overrides including clearing one identity", () => {
    const html = render(fixture(), [{ row: 4, holderId: "other", loanIdentity: undefined }]);
    expect(html).toContain('value="other" selected=""');
    expect(html).not.toContain('value="holder" selected=""');
    expect(html).not.toContain('value="loan" selected=""');
    expect(html).not.toContain("Vínculo confirmado");
  });

  it("distinguishes unavailable bases from an employee without benefits", () => {
    const data = fixture();
    data.sources[1].ready = false;
    data.sources[2].ready = false;
    data.issues = ["As bases ainda não foram publicadas."];
    data.canExport = false;
    const html = render(data);
    expect(html.match(/Base pendente/g)).toHaveLength(2);
    expect(html).not.toContain("Sem valor identificado");
    expect(html).toContain("Colaboradores pendentes");
    expect(html).toContain("Pendências da competência");
    expect(render().match(/Sem valor identificado/g)).toHaveLength(2);
  });

  it("identifies the Unimed fallback without implying a loan fallback", () => {
    const data = fixture();
    data.sources[0] = { ...data.sources[0], competency: "2026-08", fallback: true };
    data.sources[1] = { ...data.sources[1], competency: "2026-08", fallback: true };
    const html = render(data);
    expect(html).toContain("Base alternativa da Unimed · 08/2026");
    expect(html).toContain("Consignado Digital permanece em 09/2026");
  });

  it("renders dates, singular counts and highlighted vacations", () => {
    const data = fixture();
    data.rows[0].highlight = true;
    const html = render(data);
    expect(html).toContain("01/08/2026");
    expect(html).toContain("01/09/2026");
    expect(html).toContain("1 colaborador · página 1 de 1");
    expect(html).toContain("Em destaque");
  });
});
