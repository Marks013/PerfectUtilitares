import { describe, expect, it, vi } from "vitest";
import type { FeriasSnapshot } from "./contracts";
import { choicesSchema } from "./contracts";
import { buildFeriasAnalysis } from "./service";
import type { FeriasInputRow } from "./workbook";

vi.mock("./repository", () => ({ readFeriasSnapshot: vi.fn() }));

const input: FeriasInputRow[] = [{ row: 4, registration: "0042", branch: "P", name: "PESSOA EXEMPLO",
  start: "2026-09-01", end: "2026-09-30", days: 30, highlight: false }];
function snapshot(): FeriasSnapshot {
  return {
    revision: "source-a", sources: [{ name: "Cadastro Unimed", ready: true, competency: "2026-09", fallback: false },
      { name: "Fatura e coparticipação", ready: true, competency: "2026-09", fallback: false },
      { name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false }],
    beneficiaries: [{ id: "holder", holderId: null, registration: "42", fullName: "PESSOA EXEMPLO",
      cpf: "52998224725", branchId: "branch", category: "HOLDER", birthDate: "1990-01-01", planCode: "1" },
      { id: "dependent", holderId: "holder", registration: null, fullName: "DEPENDENTE EXEMPLO",
        cpf: null, branchId: "branch", category: "DEPENDENT", birthDate: "2010-01-01", planCode: "1" }],
    invoices: [
      { id: "i1", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "MENSALIDADE", amount: "999.00" },
      { id: "i2", beneficiaryId: "dependent", branchId: "branch", beneficiaryName: "DEPENDENTE EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "DEPENDENT", itemDescription: "MENSALIDADE", amount: "203.71" },
      { id: "i3", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "ADITIVO", amount: "6.12" },
      { id: "i4", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "COPARTICIPACAO", amount: "321.00" },
    ],
    loans: [{ id: "loan", beneficiaryId: "holder", registration: "INCOMPATIVEL", employeeName: "PESSOA EXEMPLO",
      cpfNormalized: "52998224725", contractNumber: "A", installmentAmount: "0.10", competence: "2026-09",
      startCompetence: "2026-01", endCompetence: "2027-12", bankCode: "1", companyCnpj: null },
      { id: "loan2", beneficiaryId: "holder", registration: "INCOMPATIVEL", employeeName: "PESSOA EXEMPLO",
        cpfNormalized: "52998224725", contractNumber: "B", installmentAmount: "0.20", competence: "2026-09",
        startCompetence: "2026-01", endCompetence: "2027-12", bankCode: "1", companyCnpj: null }],
    prices: [{ id: "price", planCode: "1", employeeAmount: "61.26", companyAmount: "213.39",
      validFrom: "2026-08-01", validTo: null, ageBracket: { code: "34-38", minAge: 34, maxAge: 38 } }],
  };
}
const analyze = (data = snapshot()) => buildFeriasAnalysis(data, input, "2026-09", [], "file-hash");

describe("Férias: competência, identidade e valores", () => {
  it("uses registered titular price, dependent monthly amounts and independent addons, not procedures", () => {
    const result = analyze();
    expect(result.canExport).toBe(true);
    expect(result.rows[0].unimedText).toBe("Mens.: 264,97 + Adit.: 6,12");
    expect(result.rows[0].loanText).toBe("Consig.R$ 0,30");
    expect(result.competency).toBe("2026-09");
  });
  it("reads employeeAmount changes from registered table instead of a hardcoded amount", () => {
    const data = snapshot();
    data.prices[0].employeeAmount = "54.21";
    expect(analyze(data).rows[0].unimedText).toBe("Mens.: 257,92 + Adit.: 6,12");
  });
  it("requires confirmation for exact-name loans without Unimed", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanCandidates).toHaveLength(1);
    expect(result.rows[0].issues).toContain("O Consignado foi localizado somente pelo nome. Confirme a pessoa correta na lista desta linha.");
    const confirmed = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, loanIdentity: "loan" }], "file-hash");
    expect(confirmed.canExport).toBe(true);
    expect(confirmed.rows[0].unimedText).toBe("");
    expect(confirmed.rows[0].loanText).toBe("Consig.R$ 0,30");
  });
  it("distinguishes empty published bases from missing sources and still analyzes available benefits", () => {
    const data = snapshot(); data.loans = [];
    expect(analyze(data).canExport).toBe(true);
    data.sources[2].ready = false;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.rows[0].unimedText).not.toBe("");
  });
  it("leaves both fields empty when no benefit is located", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = []; data.loans = []; data.prices = [];
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].warnings).toContain("Nenhum valor de Unimed ou Consignado foi localizado nas bases informadas acima.");
  });
  it("blocks absent table, unlinked dependents and repeated monthly billings", () => {
    const noPrices = snapshot(); noPrices.prices = [];
    expect(analyze(noPrices).canExport).toBe(false);
    const unlinked = snapshot(); unlinked.invoices[1].beneficiaryId = null;
    expect(analyze(unlinked).canExport).toBe(false);
    const duplicated = snapshot(); duplicated.invoices.push({ ...duplicated.invoices[1], id: "duplicate" });
    expect(analyze(duplicated).canExport).toBe(false);
  });
  it("never accepts previous-month loans and rejects repeated loan contracts", () => {
    const oldLoan = snapshot(); oldLoan.loans[0].competence = "2026-08";
    expect(analyze(oldLoan).canExport).toBe(false);
    const duplicate = snapshot(); duplicate.loans[1].contractNumber = "A";
    expect(analyze(duplicate).rows[0].loanText).toBe("");
  });
  it("accepts the previous month only for complete Unimed sources", () => {
    const data = snapshot();
    data.sources[0] = { ...data.sources[0], competency: "2026-08", fallback: true };
    data.sources[1] = { ...data.sources[1], competency: "2026-08", fallback: true };
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.sources[2]).toMatchObject({ competency: "2026-09", fallback: false });
  });
  it("explains incomplete Unimed fallback and blocks missing exact-month loans", () => {
    const data = snapshot();
    data.sources[0] = { ...data.sources[0], ready: false, competency: "2026-08", fallback: true };
    data.sources[1] = { ...data.sources[1], ready: false, competency: "2026-08", fallback: true };
    data.sources[2].ready = false;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.issues[0]).toContain("09/2026 nem em 08/2026");
    expect(result.issues[1]).toContain("não usa o mês anterior");
  });
  it("rejects a selection from another tenant/file and requires confirmation for name-only holder", () => {
    expect(() => buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 4, holderId: "foreign" }], "f")).toThrow();
    expect(() => buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 8, holderId: "holder" }], "f")).toThrow();
    const data = snapshot(); data.beneficiaries[0].registration = "999";
    expect(analyze(data).canExport).toBe(false);
    expect(analyze(data).rows[0].issues).toContain("A matrícula não confirmou o titular localizado pelo nome. Escolha a pessoa correta na lista Unimed desta linha.");
    expect(buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, holderId: "holder" }], "f").canExport).toBe(true);
  });
  it("blocks a contradictory CPF even for an exact matching name", () => {
    const data = snapshot(); for (const loan of data.loans) loan.cpfNormalized = "11144477735";
    expect(analyze(data).canExport).toBe(false);
  });
  it("does not merge same-name loans from distinct companies without a reliable CPF", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.loans[0].cpfNormalized = null; data.loans[1].cpfNormalized = null;
    data.loans[0].companyCnpj = "11111111000111"; data.loans[1].companyCnpj = "22222222000122";
    const result = analyze(data);
    expect(result.rows[0].loanCandidates).toHaveLength(2);
    expect(result.canExport).toBe(false);
    const selected = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, loanIdentity: "loan" }], "f");
    expect(selected.rows[0].loanText).toBe("Consig.R$ 0,10");
  });
  it("blocks duplicated funeral accessory amounts instead of adding them twice", () => {
    const data = snapshot(); data.invoices.push({ ...data.invoices[2], id: "another-addon" });
    expect(analyze(data).canExport).toBe(false);
  });
  it("binds revision to source versions, file and confirmations", () => {
    const first = analyze(); const data = snapshot(); data.revision = "source-b";
    expect(analyze(data).revision).not.toBe(first.revision);
    expect(buildFeriasAnalysis(snapshot(), input, "2026-09", [], "new-file").revision).not.toBe(first.revision);
    expect(buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 4, holderId: "holder" }], "file-hash").revision).not.toBe(first.revision);
    expect(analyze().revision).toBe(first.revision);
  });
  it("rejects duplicate and unknown choice fields", () => {
    expect(choicesSchema.safeParse([{ row: 4 }, { row: 4 }]).success).toBe(false);
    expect(choicesSchema.safeParse([{ row: 4, amount: 1 }]).success).toBe(false);
  });
});
